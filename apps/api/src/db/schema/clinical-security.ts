import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, uniqueIndex, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { locations } from "./practice-access.js";
import { practices } from "./practices.js";

export const clinicalRequestKeys = pgTable("clinical_request_keys", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  actorUserId: text("actor_user_id"),
  locationId: uuid("location_id"),
  operation: varchar("operation", { length: 32 }).notNull(),
  requestKey: uuid("request_key").notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  resourceId: uuid("resource_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({name:"clinical_request_keys_location_fk",columns:[table.locationId,table.practiceId],foreignColumns:[locations.id,locations.practiceId]}),
  check("clinical_request_keys_context",sql`(${table.locationId} IS NULL AND ${table.actorUserId} IS NULL) OR (${table.locationId} IS NOT NULL AND ${table.actorUserId} IS NOT NULL AND length(btrim(${table.actorUserId})) BETWEEN 1 AND 256)`),
  uniqueIndex("clinical_request_keys_legacy_unique").on(table.practiceId,table.operation,table.requestKey).where(sql`${table.locationId} IS NULL`),
  uniqueIndex("clinical_request_keys_scoped_unique").on(table.practiceId,table.actorUserId,table.locationId,table.operation,table.requestKey).where(sql`${table.locationId} IS NOT NULL`),
  check("clinical_request_keys_operation_valid", sql`${table.operation} IN ('patients.create', 'appointments.create')`),
  check("clinical_request_keys_hash_valid", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  check("clinical_request_keys_key_v4", sql`substring(${table.requestKey}::text from 15 for 1) = '4' AND substring(${table.requestKey}::text from 20 for 1) IN ('8', '9', 'a', 'b')`),
]);

// Metadata only. The runtime can append events but cannot read or change them.
export const clinicalAuditEvents = pgTable("clinical_audit_events", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  actorUserId: text("actor_user_id").notNull(),
  locationId: uuid("location_id"),
  action: varchar("action", { length: 32 }).notNull(),
  resourceId: uuid("resource_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({name:"clinical_audit_location_fk",columns:[table.locationId,table.practiceId],foreignColumns:[locations.id,locations.practiceId]}),
  check("clinical_audit_events_actor_valid", sql`length(btrim(${table.actorUserId})) BETWEEN 1 AND 256`),
  check("clinical_audit_events_action_valid", sql`${table.action} IN ('patients.create', 'patients.read', 'patients.list', 'appointments.create', 'appointments.read', 'appointments.list')`),
  index("clinical_audit_events_practice_time_idx").on(table.practiceId, table.occurredAt),
]);
