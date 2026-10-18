import type { PoolClient } from "pg";
import { AccessError } from "./practice-policy.js";

export type OnboardingDraft = {
  practiceName: string;
  locationName: string;
  timeZone: string;
  address: string;
  step: 1 | 2 | 3;
};

/** Persist only nonclinical setup fields; never credentials, tokens or arbitrary JSON. */
export function parseOnboardingDraft(input: Record<string, unknown>): OnboardingDraft {
  const fields = ["practiceName", "locationName", "timeZone", "address", "step"];
  if (Object.keys(input).length !== fields.length || Object.keys(input).some((key) => !fields.includes(key))) {
    throw new AccessError("INVALID_ONBOARDING_DRAFT", 400, "Save only the practice setup fields.");
  }
  for (const [field, maximum] of [["practiceName", 120], ["locationName", 120], ["timeZone", 80], ["address", 500]] as const) {
    if (typeof input[field] !== "string" || input[field].length > maximum || /[\u0000-\u001f\u007f]/.test(input[field])) {
      throw new AccessError("INVALID_ONBOARDING_DRAFT", 400, "Practice setup fields must be text within the field limits.");
    }
  }
  if (![1, 2, 3].includes(input.step as number)) throw new AccessError("INVALID_ONBOARDING_STEP", 400);
  if (input.timeZone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone as string }); }
    catch { throw new AccessError("INVALID_TIME_ZONE", 400); }
  }
  return { practiceName: input.practiceName as string, locationName: input.locationName as string, timeZone: input.timeZone as string, address: input.address as string, step: input.step as 1 | 2 | 3 };
}

export function approvedFounder(userId: string, environment = process.env): boolean {
  return (environment.CAREIQ_PRACTICE_CREATOR_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** Serialize drafts with submission even before an operation row exists. */
export async function lockOnboardingActor(client: PoolClient, userId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,47))", [userId]);
}

export async function writeOnboardingDraft(client: PoolClient, userId: string, draft: OnboardingDraft) {
  const { rows: [saved] } = await client.query(`
    INSERT INTO onboarding_drafts(actor_user_id,practice_name,location_name,time_zone,address,step)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(actor_user_id) DO UPDATE SET practice_name=EXCLUDED.practice_name,
      location_name=EXCLUDED.location_name,time_zone=EXCLUDED.time_zone,address=EXCLUDED.address,step=EXCLUDED.step,updated_at=now()
    RETURNING practice_name AS "practiceName",location_name AS "locationName",time_zone AS "timeZone",address,step
  `, [userId, draft.practiceName, draft.locationName, draft.timeZone, draft.address, draft.step]);
  return saved as OnboardingDraft;
}
