import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { fileURLToPath } from "node:url";
import { connectionOptions } from "./connection.js";

const pool = new Pool(connectionOptions());

const db = drizzle(pool);

async function runMigrations() {
  try {
    console.log("Applying database migrations...");

    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    });

    console.log("Database migrations applied successfully.");
  } catch (error) {
    console.error("Database migration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runMigrations();