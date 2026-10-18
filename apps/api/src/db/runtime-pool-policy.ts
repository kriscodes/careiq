import type { PoolConfig } from 'pg';

function bounded(environment: NodeJS.ProcessEnv, key: string, fallback: number, minimum: number, maximum: number) {
  const value = environment[key];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${key} must be an integer within the documented runtime budget.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${key} is outside the documented runtime budget.`);
  return parsed;
}

export const runtimeConnectTimeout = (environment: NodeJS.ProcessEnv = process.env) => bounded(environment, 'DATABASE_POOL_CONNECT_TIMEOUT_MS', 10000, 100, 30000);

/** Per API process. Migration/administrative pools do not use these runtime limits. */
export function runtimePoolPolicy(environment: NodeJS.ProcessEnv = process.env): { options: PoolConfig; maxWaiting: number } {
  return {
    maxWaiting: bounded(environment, 'DATABASE_POOL_MAX_WAITING', 40, 0, 200),
    options: {
      max: bounded(environment, 'DATABASE_POOL_MAX', 10, 1, 50),
      connectionTimeoutMillis: runtimeConnectTimeout(environment),
      idleTimeoutMillis: 10000,
      statement_timeout: bounded(environment, 'DATABASE_STATEMENT_TIMEOUT_MS', 30000, 1000, 120000),
      lock_timeout: bounded(environment, 'DATABASE_LOCK_TIMEOUT_MS', 5000, 100, 30000),
      idle_in_transaction_session_timeout: bounded(environment, 'DATABASE_IDLE_TRANSACTION_TIMEOUT_MS', 30000, 1000, 120000),
    },
  };
}
