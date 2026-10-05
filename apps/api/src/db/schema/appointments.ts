import {
    foreignKey,
    index,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { patients } from "./patients.js";
import { locations } from "./practice-access.js";
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

    locationId: uuid("location_id"),

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
    foreignKey({name:"appointments_location_practice_fk",columns:[table.locationId,table.practiceId],foreignColumns:[locations.id,locations.practiceId]}),
    foreignKey({name:"appointments_patient_location_fk",columns:[table.patientId,table.practiceId,table.locationId],foreignColumns:[patients.id,patients.practiceId,patients.locationId]}),
    index("appointments_location_schedule_idx").on(table.practiceId,table.locationId,table.scheduledAt,table.id),
    index("appointments_practice_schedule_idx").on(table.practiceId, table.scheduledAt, table.id),
    foreignKey({
      columns: [table.patientId, table.practiceId],
      foreignColumns: [patients.id, patients.practiceId],
      name: "appointments_patient_practice_fk",
    }),
  ],
);
