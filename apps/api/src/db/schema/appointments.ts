import {
    foreignKey,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { patients } from "./patients.js";
import { practices } from "./practices.js";

export const appointments = pgTable(
    "appointments", 
    {
    id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),

    practiceId: uuid("practice_id")
    .notNull()
    .references(() => practices.id),

    patientId: uuid("patient_id")
    .notNull(),

    scheduledAt: timestamp("scheduled_at", {
        withTimezone: true,
    }).notNull(),

    status: text("status")
    .notNull()
    .default("scheduled"),

    reason: text("reason"),

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
},
(table) => [
    foreignKey({
      columns: [table.patientId, table.practiceId],
      foreignColumns: [patients.id, patients.practiceId],
      name: "appointments_patient_practice_fk",
    }),
  ],
);