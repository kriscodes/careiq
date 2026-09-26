import { asc, eq } from "drizzle-orm";

import { appointments } from "../db/schema/appointments.js";
import { patients } from "../db/schema/patients.js";
import type { TenantContext } from "../middleware/tenant-context.js";
import { withTenant } from "../db/with-tenant.js";

export type CreateAppointmentInput = {
    patientId: string;
    scheduledAt: Date;
    reason?: string;
};

export async function createAppointment(
    tenant: TenantContext,
    input: CreateAppointmentInput,
) {
    return withTenant(tenant.practiceId, async (tx) => {
        const [patient] = await tx
        .select({
            id: patients.id,
            practiceId: patients.practiceId,
        })
        .from(patients)
        .where(eq(patients.id, input.patientId))
        .limit(1);

        if(!patient) {
            throw new Error("PATIENT_NOT_FOUND");
        }

        const [appointment] = await tx
        .insert(appointments)
        .values({
            practiceId: tenant.practiceId,
            patientId: input.patientId,
            scheduledAt: input.scheduledAt,
            reason: input.reason ?? null,
        })
        .returning();

        return appointment;
    });
}

export async function listAppointments(
    tenant: TenantContext,
) {
    return withTenant(tenant.practiceId, async (tx) => {
        return tx 
        .select()
        .from(appointments)
        .orderBy(asc(appointments.scheduledAt));
    }); 
}