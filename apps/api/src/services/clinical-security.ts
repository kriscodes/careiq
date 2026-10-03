import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { clinicalAuditEvents, clinicalRequestKeys } from "../db/schema/clinical-security.js";
import { withTenant } from "../db/with-tenant.js";
import type { TenantContext } from "../middleware/tenant-context.js";

export type ClinicalTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CreateOperation = "patients.create" | "appointments.create";
type AuditAction = CreateOperation | "patients.read" | "patients.list" | "appointments.read" | "appointments.list";
export type ListOptions = { limit?: number; offset?: number };

export function pageOptions(options: ListOptions) {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  // The API requests one extra row to calculate hasMore; callers cannot read an unbounded list.
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new Error("INVALID_PAGINATION");
  }
  return { limit, offset };
}

export async function recordClinicalAudit(tx: ClinicalTransaction, tenant: TenantContext, action: AuditAction, resourceId?: string): Promise<void> {
  await tx.insert(clinicalAuditEvents).values({
    practiceId: tenant.practiceId, actorUserId: tenant.userId, action, resourceId: resourceId ?? null,
  });
}

export async function recordClinicalReads(tx: ClinicalTransaction, tenant: TenantContext, action: "patients.read" | "appointments.read", resourceIds: string[]): Promise<void> {
  if (resourceIds.length === 0) return;
  await tx.insert(clinicalAuditEvents).values(resourceIds.map((resourceId) => ({
    practiceId: tenant.practiceId, actorUserId: tenant.userId, action, resourceId,
  })));
}

export async function clinicalCreate<T extends { id: string }>(options: {
  tenant: TenantContext;
  operation: CreateOperation;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  create: (tx: ClinicalTransaction) => Promise<T>;
  find: (tx: ClinicalTransaction, id: string) => Promise<T | undefined>;
}): Promise<T> {
  const { tenant, operation, payload, create, find } = options;
  const key = options.idempotencyKey?.toLowerCase();
  if (key !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  }
  const requestHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return withTenant(tenant.practiceId, async (tx) => {
    if (key) {
      // A transaction lock serializes simultaneous retries before their lookup.
      // Hash collisions only serialize unrelated requests; the full key is stored.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenant.practiceId}:${operation}:${key}`}, 0))`);
      const [previous] = await tx.select().from(clinicalRequestKeys).where(and(
        eq(clinicalRequestKeys.practiceId, tenant.practiceId), eq(clinicalRequestKeys.operation, operation), eq(clinicalRequestKeys.requestKey, key),
      )).limit(1);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
        const resource = await find(tx, previous.resourceId);
        if (!resource) throw new Error("IDEMPOTENCY_RESOURCE_UNAVAILABLE");
        await recordClinicalAudit(tx, tenant, operation === "patients.create" ? "patients.read" : "appointments.read", resource.id);
        return resource;
      }
    }
    const resource = await create(tx);
    if (key) await tx.insert(clinicalRequestKeys).values({ practiceId: tenant.practiceId, operation, requestKey: key, requestHash, resourceId: resource.id });
    await recordClinicalAudit(tx, tenant, operation, resource.id);
    return resource;
  });
}
