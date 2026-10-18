import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { connectionOptions } from "./connection.js";
import { assertMigrationLedger, assertMigrationTarget, migrationManifest, migrationsFolder, readMigrationLedger, ReleaseCheckError } from "./migration-safety.js";
import { logFailure } from "../logging.js";

async function runMigrations() {
  const options = connectionOptions();
  if (process.env.NODE_ENV === "production" && options.ssl === false) throw new ReleaseCheckError("Production migrations require encrypted database transport.");
  const manifest = await migrationManifest();
  const pool = new Pool(options);
  try {
    const client = await pool.connect();
    let locked = false;
    try {
      const { rows } = await client.query("SELECT current_database() AS name");
      const confirmIndex = process.argv.indexOf("--confirm-database");
      assertMigrationTarget(options.connectionString!, rows[0].name, confirmIndex < 0 ? undefined : process.argv[confirmIndex + 1]);
      const lock = await client.query("SELECT pg_try_advisory_lock(164395, 1) AS acquired");
      if (!lock.rows[0].acquired) throw new ReleaseCheckError("Another migration is running; retry after it completes.");
      locked = true;
      await client.query("SET lock_timeout='10s'; SET statement_timeout='5min'");
      assertMigrationLedger(manifest, await readMigrationLedger(client));
      console.log("Applying verified database migrations...");
      await migrate(drizzle(client), { migrationsFolder });
      assertMigrationLedger(manifest, await readMigrationLedger(client), true);
      console.log(`Database migration history verified (${manifest.length} entries).`);
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(164395, 1)");
      client.release();
    }
  } finally { await pool.end(); }
}
runMigrations().catch((error) => {
  if (error instanceof ReleaseCheckError) console.error(error.message);
  else logFailure("Database migration failed", error);
  process.exitCode = 1;
});
