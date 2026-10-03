import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool } from "./pool.js";
import { connectionOptions } from "./connection.js";

export const pool = createDatabasePool(connectionOptions());
export const db = drizzle(pool);
