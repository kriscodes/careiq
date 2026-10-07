import "dotenv/config";
import { Pool } from "pg";
import { connectionOptions } from "./connection.js";
import { verifyDatabaseRelease } from "./release-check.js";
import { ProductionConfigurationError, validateProductionConfiguration } from "../production-config.js";
import { interviewRequestsEnabled } from "../public-config.js";
import { ReleaseCheckError } from "./migration-safety.js";
import { logFailure } from "../logging.js";

async function verify() {
  if (!process.argv.includes("--database-only")) {
    if (process.env.NODE_ENV !== "production") throw new ReleaseCheckError("Release verification requires NODE_ENV=production; --database-only checks restricted local database configuration separately.");
    validateProductionConfiguration();
  }
  const pool = new Pool(connectionOptions());
  try {
    const client = await pool.connect();
    try { await client.query("BEGIN READ ONLY"); await verifyDatabaseRelease(client, interviewRequestsEnabled()); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    console.log("API release database checks passed. This does not certify provider configuration, hosted acceptance or device authentication.");
  } finally { await pool.end(); }
}
verify().catch((error) => { if (error instanceof ReleaseCheckError || error instanceof ProductionConfigurationError) console.error(error.message); else logFailure("API release verification failed", error); process.exitCode = 1; });
