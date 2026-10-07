import { sql } from "drizzle-orm";
import { check, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

// Business contact data is deliberately separate from tenant/clinical tables.
export const marketingInterviewRequests = pgTable("marketing_interview_requests", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 254 }).notNull(),
  role: varchar("role", { length: 32 }).notNull(),
  practiceName: varchar("practice_name", { length: 160 }),
  submissionKey: uuid("submission_key").notNull().unique(),
  source: varchar("source", { length: 32 }).notNull().default("marketing_homepage"),
  privacyNoticeVersion: varchar("privacy_notice_version", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("marketing_interview_requests_name_nonempty", sql`length(btrim(${table.name})) > 0`),
  check("marketing_interview_requests_email_nonempty", sql`length(btrim(${table.email})) > 0`),
  check("marketing_interview_requests_role_valid", sql`${table.role} IN ('practice_owner', 'practice_manager', 'administrative_staff', 'provider', 'other')`),
  check("marketing_interview_requests_source_valid", sql`${table.source} = 'marketing_homepage'`),
  check("marketing_interview_requests_notice_nonempty", sql`length(btrim(${table.privacyNoticeVersion})) > 0`),
  check("marketing_interview_requests_key_v4", sql`substring(${table.submissionKey}::text from 15 for 1) = '4' AND substring(${table.submissionKey}::text from 20 for 1) IN ('8', '9', 'a', 'b')`),
]);
