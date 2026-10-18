import { Pool, type PoolConfig, type PoolClient } from 'pg';
import { logFailure } from '../logging.js';
import { runtimePoolPolicy } from './runtime-pool-policy.js';

export class DatabaseBusyError extends Error {
  readonly code = 'DATABASE_BUSY';
  readonly status = 503;
  constructor() { super('The database is busy. Try again shortly.'); }
}
type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, release: (error?: unknown) => void) => void;
const admissionError = (error: Error | undefined) => error && ['timeout exceeded when trying to connect', 'Connection terminated due to connection timeout'].includes(error.message) ? new DatabaseBusyError() : error;

/** Bound waiting work as well as active connections; retain pg's FIFO/recovery behavior. */
export function createDatabasePool(options: PoolConfig, reportFailure = logFailure, environment: NodeJS.ProcessEnv = process.env): Pool {
  const policy = runtimePoolPolicy(environment);
  const pool = new Pool({ ...policy.options, ...options });
  const checkedOut = new WeakSet<PoolClient>();
  const reportedFailures = new WeakSet<PoolClient>();
  const reportClientFailure = (operation: string, error: unknown, client?: PoolClient) => {
    if (client) {
      if (reportedFailures.has(client)) return;
      reportedFailures.add(client);
    }
    reportFailure(operation, error);
  };
  // pg-pool removes its idle error listener on checkout. Keep a pool-owned
  // listener for server disconnects while application work awaits outside SQL.
  // pg marks the client non-queryable; the caller's normal finally/release
  // evicts it. Releasing here would race the caller and double-release it.
  pool.on('connect', client => {
    client.on('error', error => {
      if (checkedOut.has(client)) reportClientFailure('PostgreSQL checked-out connection failed', error, client);
    });
  });
  pool.on('acquire', client => checkedOut.add(client));
  pool.on('release', (_error, client) => checkedOut.delete(client));
  pool.on('remove', client => checkedOut.delete(client));
  const connect = pool.connect.bind(pool);
  pool.connect = ((callback?: ConnectCallback) => {
    // pg defers idle-client dispatch until nextTick. Pending checkouts also reserve
    // currently idle/new connection slots, including bursts in the same JS turn.
    const immediateCapacity = pool.idleCount + Math.max(0, pool.options.max - pool.totalCount);
    if (!pool.ending && pool.waitingCount >= policy.maxWaiting + immediateCapacity) {
      const error = new DatabaseBusyError();
      if (callback) { queueMicrotask(() => callback(error, undefined, () => {})); return; }
      return Promise.reject(error);
    }
    if (callback) return connect((error, client, release) => callback(admissionError(error), client, release));
    return connect().catch(error => { throw admissionError(error); });
  }) as typeof pool.connect;
  pool.on('error', (error, client) => {
    // Never log client configuration, raw exception messages, SQL or patient data.
    reportClientFailure('PostgreSQL idle connection failed', error, client);
  });
  return pool;
}
