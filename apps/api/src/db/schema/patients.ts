import { 
    foreignKey,
    bigint,
    check,
    date,
    pgTable, 
    text, 
    timestamp, 
    unique,
    index,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { locations } from "./practice-access.js";
import { practices } from "./practices.js";


export const patients = pgTable(
    "patients",
    {
        id: uuid("id")
        .primaryKey()
        .default(sql`uuidv7()`),
        
        practiceId: uuid("practice_id")
        .notNull()
        .references(() => practices.id),

        locationId: uuid("location_id"),

        preferredName: text("preferred_name"),
        dateOfBirth: date("date_of_birth"),
        archivedAt: timestamp("archived_at", {withTimezone:true}),
        revision: bigint("revision", {mode:"number"}).notNull().default(1),
        firstName: text("first_name").notNull(),

        lastName: text("last_name").notNull(),

        email: text("email"),

        phone: text("phone"),

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
    index("patients_scope_created_idx").on(table.practiceId,table.locationId,table.createdAt.desc(),table.id.desc()),
    check("patients_revision_check",sql`${table.revision}>0`),
    foreignKey({name:"patients_location_practice_fk",columns:[table.locationId,table.practiceId],foreignColumns:[locations.id,locations.practiceId]}),
    unique("patients_id_practice_location_unique").on(table.id,table.practiceId,table.locationId),
    index("patients_location_name_idx").on(table.practiceId,table.locationId,table.lastName,table.firstName,table.id),
    index("patients_practice_name_idx").on(table.practiceId, table.lastName, table.firstName, table.id),
    unique("patients_id_practice_id_unique").on(
      table.id,
      table.practiceId,
    ),
  ],
);
