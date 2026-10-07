import type { RequestAuthentication } from "../middleware/tenant-context.js";
import { practiceTransaction } from "../db/practice-transaction.js";
import { verifiedEmails } from "./clerk-directory.js";
import { AccessError } from "./practice-policy.js";
import { approvedFounder, lockOnboardingActor, parseOnboardingDraft, writeOnboardingDraft, type OnboardingDraft } from "./onboarding-draft.js";

export type OnboardingState = {
  eligible: boolean;
  emailVerified: boolean;
  draft: OnboardingDraft | null;
  operation: { state: "pending" | "complete"; practiceId: string | null; organizationId: string | null } | null;
};

function actor(auth: RequestAuthentication) {
  if (!auth.isAuthenticated || !auth.userId) throw new AccessError("UNAUTHENTICATED", 401);
  return auth.userId;
}

/** Reads identity eligibility and actor-owned metadata without provisioning or selecting a practice. */
export async function getOnboardingState(auth: RequestAuthentication): Promise<OnboardingState> {
  const userId = actor(auth);
  const emailVerified = (await verifiedEmails(userId)).length > 0;
  const metadata = await practiceTransaction(null, userId, async (client) => {
    const { rows: [state] } = await client.query(`
      SELECT CASE WHEN d.actor_user_id IS NULL THEN NULL ELSE jsonb_build_object(
        'practiceName',d.practice_name,'locationName',d.location_name,'timeZone',d.time_zone,'address',d.address,'step',d.step) END AS draft,
        CASE WHEN o.actor_user_id IS NULL THEN NULL ELSE jsonb_build_object(
          'state',o.status,'practiceId',o.practice_id,'organizationId',o.clerk_org_id) END AS operation
      FROM (VALUES($1::text)) AS actor(user_id)
      LEFT JOIN onboarding_drafts d ON d.actor_user_id=actor.user_id
      LEFT JOIN practice_onboarding o ON o.actor_user_id=actor.user_id
    `, [userId]);
    return state as Pick<OnboardingState, "draft" | "operation">;
  });
  return { eligible: approvedFounder(userId), emailVerified, ...metadata };
}

export async function saveOnboardingDraft(auth: RequestAuthentication, input: Record<string, unknown>): Promise<OnboardingDraft> {
  const userId = actor(auth);
  if (!(await verifiedEmails(userId)).length) throw new AccessError("VERIFIED_EMAIL_REQUIRED");
  if (!approvedFounder(userId)) throw new AccessError("ONBOARDING_NOT_ELIGIBLE");
  const draft = parseOnboardingDraft(input);
  return practiceTransaction(null, userId, async (client) => {
    await lockOnboardingActor(client, userId);
    const { rows: [operation] } = await client.query("SELECT status FROM practice_onboarding WHERE actor_user_id=$1", [userId]);
    if (operation) throw new AccessError(operation.status === "complete" ? "ONBOARDING_ALREADY_COMPLETE" : "ONBOARDING_IN_PROGRESS", 409, "Practice setup was already submitted. Resume the original setup.");
    return writeOnboardingDraft(client, userId, draft);
  });
}
