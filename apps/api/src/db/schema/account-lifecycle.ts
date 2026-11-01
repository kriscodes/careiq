import { sql } from "drizzle-orm";
import { check, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const accountClosureRequests = pgTable("account_closure_requests", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  actorUserId: text("actor_user_id").notNull(),
  requestedSessionId: text("requested_session_id").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull().default("pending"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("account_closure_actor_check", sql`${table.actorUserId} ~ '^user_[A-Za-z0-9]+$'`),
  check("account_closure_session_check", sql`${table.requestedSessionId} ~ '^sess_[A-Za-z0-9]+$'`),
  check("account_closure_action_check", sql`${table.action} IN ('archive','delete')`),
  check("account_closure_status_check", sql`${table.status} IN ('pending','fulfilled','cancelled')`),
  uniqueIndex("account_closure_one_pending").on(table.actorUserId).where(sql`${table.status}='pending'`),
  pgPolicy("account_closure_self_read", { for: "select", to: ["public"], using: sql`${table.actorUserId}=NULLIF(current_setting('app.actor_user_id',true),'')` }),
  pgPolicy("account_closure_self_request", { for: "insert", to: ["public"], withCheck: sql`${table.actorUserId}=NULLIF(current_setting('app.actor_user_id',true),'') AND ${table.status}='pending'` }),
]).enableRLS();

export const personalAccountLifecycle = pgTable("personal_account_lifecycle", {
  userId: text("user_id").primaryKey(),
  status: text("status").notNull(),
  archiveSessionId: text("archive_session_id").notNull(),
  archiveRequestedAt: timestamp("archive_requested_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("personal_account_user_check", sql`${table.userId} ~ '^user_[A-Za-z0-9]+$'`),
  check("personal_account_session_check", sql`${table.archiveSessionId} ~ '^sess_[A-Za-z0-9]+$'`),
  check("personal_account_status_check", sql`${table.status} IN ('active','archiving','archived','restoring')`),
  pgPolicy("personal_account_self", { for: "all", to: ["public"], using: sql`${table.userId}=NULLIF(current_setting('app.actor_user_id',true),'')`, withCheck: sql`${table.userId}=NULLIF(current_setting('app.actor_user_id',true),'')` }),
]).enableRLS();
export const personalAccountEvents = pgTable("personal_account_events", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  userId: text("user_id").notNull(),
  actorReference: text("actor_reference").notNull(),
  event: text("event").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("personal_account_event_user_check", sql`${table.userId} ~ '^user_[A-Za-z0-9]+$'`),
  check("personal_account_event_actor_check", sql`length(${table.actorReference}) BETWEEN 1 AND 128`),
  check("personal_account_event_type_check", sql`${table.event} IN ('archive_requested','archive_completed','restore_requested','restore_completed')`),
  pgPolicy("personal_account_event_self_read", { for: "select", to: ["public"], using: sql`${table.userId}=NULLIF(current_setting('app.actor_user_id',true),'')` }),
  pgPolicy("personal_account_event_self_insert", { for: "insert", to: ["public"], withCheck: sql`${table.userId}=NULLIF(current_setting('app.actor_user_id',true),'')` }),
]).enableRLS();
