import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const practices = pgTable("practices", {
    id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),

    clerkOrgId: text("clerk_org_id")
    .notNull()
    .unique(),

    name: text("name")
    .notNull(),

    authorizationMode: text("authorization_mode").notNull().default("legacy"),
    status: text("status").notNull().default("active"),
    ownerUserId: text("owner_user_id"),

    createdAt: timestamp("created_at", {
        withTimezone: true,
    })
    .notNull()
    .defaultNow(),

    updatedAt: timestamp("updated_at", {
        withTimezone: true,
    })
    .notNull()
    .defaultNow(),
}, (table) => [check("practices_authorization_mode_check", sql`${table.authorizationMode} IN ('legacy','location')`),check("practices_status_check",sql`${table.status} IN ('pending','active','suspended')`)]);