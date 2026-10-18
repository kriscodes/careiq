import {
    foreignKey,
    bigint,
    check,
    unique,
    type PgTableExtraConfigValue,
    index,
    pgTable,
    text,
    timestamp,
    uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { providerLocations, visitTypes } from "./workflow.js";
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

    endsAt: timestamp("ends_at", {withTimezone:true}),
    providerId: uuid("provider_id"),
    visitTypeId: uuid("visit_type_id"),
    revision: bigint("revision",{mode:"number"}).notNull().default(1),
    cancelledAt: timestamp("cancelled_at",{withTimezone:true}),
    cancelledByActorId: text("cancelled_by_actor_id"),
    cancellationReasonCode: text("cancellation_reason_code"),
    cancellationNote: text("cancellation_note"),
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
(table): PgTableExtraConfigValue[] => [
    index("appointments_scope_created_idx").on(table.practiceId,table.locationId,table.createdAt.desc(),table.id.desc()),
    check("appointments_workflow_status_check",sql`${table.status} IN ('scheduled','confirmed','checked_in','in_progress','completed','cancelled','no_show')`),
    check("appointments_provider_interval_required",sql`${table.providerId} IS NULL OR ${table.endsAt} IS NOT NULL`),
    check("appointments_revision_check",sql`${table.revision}>0`),
    check("appointments_interval_check",sql`${table.endsAt} IS NULL OR ${table.endsAt}>${table.scheduledAt}`),
    unique("appointments_id_scope_key").on(table.id,table.practiceId,table.locationId),
    unique("appointments_patient_scope_key").on(table.id,table.patientId,table.practiceId,table.locationId),
    foreignKey({name:"appointments_provider_location_fk",columns:[table.practiceId,table.providerId,table.locationId],foreignColumns:[providerLocations.practiceId,providerLocations.providerId,providerLocations.locationId]}),
    foreignKey({name:"appointments_visit_type_scope_fk",columns:[table.visitTypeId,table.practiceId],foreignColumns:[visitTypes.id,visitTypes.practiceId]}),
    index("appointments_patient_schedule_idx").on(table.practiceId,table.locationId,table.patientId,table.scheduledAt,table.id),
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
