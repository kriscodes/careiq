import { pool } from "./client.js";
import { practiceTransaction } from "./practice-transaction.js";
import { reconcilePracticeMember, reconcilePracticeInvitations } from "../services/practice-reconciliation.js";
import { logFailure } from "../logging.js";

/** Run from a scheduler using the restricted runtime login. No clinical reads, no activation. */
async function run() {
  try {
    const practices = (await pool.query("SELECT id,clerk_org_id FROM practices WHERE authorization_mode='location'")).rows;
    for (const practice of practices) {
      const members = await practiceTransaction(practice.id, "system:clerk-reconciliation", async (client) => (await client.query("SELECT user_id FROM practice_member_access WHERE practice_id=$1", [practice.id])).rows);
      for (const member of members) await reconcilePracticeMember(practice.clerk_org_id, member.user_id);
      await reconcilePracticeInvitations(practice.clerk_org_id);
    }
    console.log("Practice membership reconciliation completed.");
  } catch (error) { logFailure("Practice reconciliation failed", error); process.exitCode = 1; }
  finally { await pool.end(); }
}
void run();
