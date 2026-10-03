import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { practices } from "./practices.js";

export const clinicalRequestKeys = pgTable("clinical_request_keys", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  operation: varchar("operation", { length: 32 }).notNull(),
  requestKey: uuid("request_key").notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  resourceId: uuid("resource_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.practiceId, table.operation, table.requestKey] }),
  check("clinical_request_keys_operation_valid", sql`${table.operation} IN ('patients.create', 'appointments.create')`),
  check("clinical_request_keys_hash_valid", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("clinical_request_keys_key_v4", sql`substring(${table.requestKey}::text from 15 for 1) = '4' AND substring(${table.requestKey}::text from 20 for 1) IN ('8', '9', 'a', 'b')`),
]);

// Metadata only. The runtime can append events but cannot read or change them.
export const clinicalAuditEvents = pgTable("clinical_audit_events", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  actorUserId: text("actor_user_id").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  resourceId: uuid("resource_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("clinical_audit_events_actor_valid", sql`length(btrim(${table.actorUserId})) BETWEEN 1 AND 256`),
  check("clinical_audit_events_action_valid", sql`${table.action} IN ('patients.create', 'patients.read', 'patients.list', 'appointments.create', 'appointments.read', 'appointments.list')`),
  index("clinical_audit_events_practice_time_idx").on(table.practiceId, table.occurredAt),
]);
