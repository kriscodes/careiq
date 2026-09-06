import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm"

import { practices } from "./practices.js"

export const tenantTestRecords = pgTable("tenant_test_records", {
    id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),

    practiceId: uuid("practice_id")
    .notNull()
    .references(() => practices.id),

    value: text("value").notNull(),

    createdAt: timestamp("created_at", {
        withTimezone: true,
    })
    .notNull()
    .defaultNow(),
});