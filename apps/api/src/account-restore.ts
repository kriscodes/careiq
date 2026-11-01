import "dotenv/config";
import { parseAccountRestoreArguments } from "./services/account-restore-policy.js";

async function restore() {
  const input = parseAccountRestoreArguments(process.argv.slice(2));
  const { clerk } = await import("./services/clerk-directory.js");
  if ((await clerk.instance.get()).environmentType !== input.environment) throw new Error("RESTORE_ENVIRONMENT_MISMATCH");
  const { pool } = await import("./db/client.js");
  try {
    const client = await pool.connect();
    try { await (await import("./db/release-check.js")).verifyDatabaseRelease(client); } finally { client.release(); }
    // Operators must first verify the identity and that this ban belongs to an archive.
    await (await import("./services/account-lifecycle.service.js")).accountLifecycle.restoreForOperator(input.userId, { operatorReference: input.operatorReference, confirmation: input.confirmation });
    console.log("Account restoration completed. A new sign-in is required.");
  } finally { await pool.end(); }
}
void restore().catch(cause => {
  const message = cause instanceof Error && cause.message === "RESTORE_ARGUMENTS_INVALID" ? "Provide --user-id, --reference, --confirm RESTORE and --environment development|production exactly once." : cause instanceof Error && cause.message === "RESTORE_ENVIRONMENT_MISMATCH" ? "Restoration stopped: the provider environment does not match the explicit target." : "Account restoration did not complete. Review the account state before retrying.";
  console.error(message); process.exitCode = 1;
});
