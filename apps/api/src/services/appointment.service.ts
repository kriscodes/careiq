import { and, asc, eq } from "drizzle-orm";
import { appointments } from "../db/schema/appointments.js";
import { patients } from "../db/schema/patients.js";
import type { TenantContext } from "../middleware/tenant-context.js";
import { withTenant } from "../db/with-tenant.js";
import { clinicalCreate, pageOptions, recordClinicalAudit, recordClinicalReads, type ListOptions } from "./clinical-security.js";

export type CreateAppointmentInput = { patientId: string; scheduledAt: Date; reason?: string };

export async function createAppointment(tenant: TenantContext, input: CreateAppointmentInput, idempotencyKey?: string) {
  const payload = { patientId: input.patientId.toLowerCase(), scheduledAt: input.scheduledAt.toISOString(), reason: input.reason?.trim() || null };
  return clinicalCreate({ tenant, operation: "appointments.create", payload, idempotencyKey,
    create: async (tx) => {
      const [patient] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.id, payload.patientId), eq(patients.practiceId, tenant.practiceId), tenant.locationId ? eq(patients.locationId, tenant.locationId) : undefined)).limit(1);
      if (!patient) throw new Error("PATIENT_NOT_FOUND");
      const [appointment] = await tx.insert(appointments).values({
        practiceId: tenant.practiceId, locationId: tenant.locationId ?? null, patientId: payload.patientId, scheduledAt: new Date(payload.scheduledAt), reason: payload.reason,
      }).returning();
      return appointment;
    },
    find: async (tx, id) => (await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.practiceId, tenant.practiceId), tenant.locationId ? eq(appointments.locationId, tenant.locationId) : undefined)).limit(1))[0],
  });
}

export async function listAppointments(tenant: TenantContext, options: ListOptions = {}) {
  const { limit, offset } = pageOptions(options);
  return withTenant(tenant, async (tx) => {
    const rows = await tx.select().from(appointments).where(and(eq(appointments.practiceId, tenant.practiceId), tenant.locationId ? eq(appointments.locationId, tenant.locationId) : undefined))
      .orderBy(asc(appointments.scheduledAt), asc(appointments.id)).limit(limit).offset(offset);
    await recordClinicalAudit(tx, tenant, "appointments.list");
    await recordClinicalReads(tx, tenant, "appointments.read", rows.map((row) => row.id));
    return rows;
  });
}
