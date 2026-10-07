import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const onboardingDrafts = pgTable("onboarding_drafts", {
  actorUserId: text("actor_user_id").primaryKey(),
  practiceName: text("practice_name").notNull().default(""),
  locationName: text("location_name").notNull().default(""),
  timeZone: text("time_zone").notNull().default(""),
  address: text("address").notNull().default(""),
  step: integer("step").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (draft) => [
  check("onboarding_drafts_actor_check", sql`length(btrim(${draft.actorUserId})) BETWEEN 1 AND 256`),
  check("onboarding_drafts_practice_name_check", sql`length(${draft.practiceName}) <= 120`),
  check("onboarding_drafts_location_name_check", sql`length(${draft.locationName}) <= 120`),
  check("onboarding_drafts_time_zone_check", sql`length(${draft.timeZone}) <= 80`),
  check("onboarding_drafts_address_check", sql`length(${draft.address}) <= 500`),
  check("onboarding_drafts_step_check", sql`${draft.step} IN (1,2,3)`),
]);
