import { asc } from "drizzle-orm";

import { patients } from "../db/schema/patients.js";
import type { TenantContext } from "../middleware/tenant-context.js";
import { withTenant } from "../db/with-tenant.js";

export type CreatePatientInput = {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
};

export async function createPatient(
    tenant: TenantContext,
    input: CreatePatientInput,
) {
    return withTenant(tenant.practiceId, async (tx) => {
        const [patient] = await tx
        .insert(patients)
        .values({
            practiceId: tenant.practiceId,
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email ?? null,
            phone: input.phone ?? null,
        })
        .returning();

        return patient;
    });
}

export async function listPatients(tenant: TenantContext) {
    return withTenant(tenant.practiceId, async (tx) => {
        return tx
        .select()
        .from(patients)
        .orderBy(asc(patients.lastName), asc(patients.firstName));
    })
}