import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { connectionOptions } from "./connection.js";

export const pool = new Pool(connectionOptions());
export const db = drizzle(pool);
