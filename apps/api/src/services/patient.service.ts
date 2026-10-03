import { asc, eq } from "drizzle-orm";
import { patients } from "../db/schema/patients.js";
import type { TenantContext } from "../middleware/tenant-context.js";
import { withTenant } from "../db/with-tenant.js";
import { clinicalCreate, pageOptions, recordClinicalAudit, recordClinicalReads, type ListOptions } from "./clinical-security.js";

export type CreatePatientInput = { firstName: string; lastName: string; email?: string; phone?: string };

export async function createPatient(tenant: TenantContext, input: CreatePatientInput, idempotencyKey?: string) {
  const payload = {
    firstName: input.firstName.trim(), lastName: input.lastName.trim(),
    email: input.email?.trim() || null, phone: input.phone?.trim() || null,
  };
  return clinicalCreate({ tenant, operation: "patients.create", payload, idempotencyKey,
    create: async (tx) => {
      const [patient] = await tx.insert(patients).values({ practiceId: tenant.practiceId, ...payload }).returning();
      return patient;
    },
    find: async (tx, id) => (await tx.select().from(patients).where(eq(patients.id, id)).limit(1))[0],
  });
}

export async function listPatients(tenant: TenantContext, options: ListOptions = {}) {
  const { limit, offset } = pageOptions(options);
  return withTenant(tenant.practiceId, async (tx) => {
    const rows = await tx.select().from(patients)
      .orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.id)).limit(limit).offset(offset);
    await recordClinicalAudit(tx, tenant, "patients.list");
    await recordClinicalReads(tx, tenant, "patients.read", rows.map((row) => row.id));
    return rows;
  });
}
