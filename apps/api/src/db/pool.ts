import { Pool, type PoolConfig } from "pg";
import { logFailure } from "../logging.js";

/** pg removes failed idle clients; handling this event lets later queries reconnect. */
export function createDatabasePool(options: PoolConfig, reportFailure = logFailure): Pool {
  const pool = new Pool(options);
  pool.on("error", (error) => {
    // Do not include the client, connection options or raw exception in logs.
    reportFailure("PostgreSQL idle connection failed", error);
  });
  return pool;
}
