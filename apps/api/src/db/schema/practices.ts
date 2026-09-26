import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
});