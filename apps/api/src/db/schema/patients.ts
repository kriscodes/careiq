import { 
    pgTable, 
    text, 
    timestamp, 
    unique,
    index,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    index("patients_practice_name_idx").on(table.practiceId, table.lastName, table.firstName, table.id),
    unique("patients_id_practice_id_unique").on(
      table.id,
      table.practiceId,
    ),
  ],
);
