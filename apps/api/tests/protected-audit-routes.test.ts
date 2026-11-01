import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import type { PoolClient } from "pg";
import type { PracticeAccess } from "../src/routes/practice-access.js";
import { registerProtectedAuditRoutes } from "../src/routes/protected-audit.js";
import { parseAuditFilter, type AuditFilter } from "../src/services/protected-audit.service.js";
import { WorkflowError } from "../src/workflow/policy.js";

test("audit HTTP exports authorize normalized evidence flags and recheck current download permission", async () => {
  const tenant = { practiceId: randomUUID(), locationId: randomUUID(), userId: "user_AuditReviewer", membershipId: "mem_AuditReviewer", orgId: "org_AuditReview" };
  const app = express(); app.use(express.json());
  let permissions = ["org:audit:read", "org:audit:export"];
  const exportedFilters: AuditFilter[] = [], commandFilters: unknown[] = [], downloadPermissions: boolean[] = [], failures: string[] = [];
  const bytes = Buffer.from('{"synthetic":true}');
  registerProtectedAuditRoutes(app, () => ({ isAuthenticated: true, userId: tenant.userId, sessionId: "sess_AuditReviewer" }), {
    authorizeLocation: async () => ({ tenant, capabilities: {}, permissions }),
  } as unknown as PracticeAccess, {
    currentMembership: async () => ({ id: tenant.membershipId, userId: tenant.userId, role: "org:member", permissions }),
    command: async (_tenant, _operation, _target, input, _context, execute) => {
      commandFilters.push((input as { filter: AuditFilter }).filter);
      return execute({} as PoolClient);
    },
    service: {
      parseAuditFilter,
      exportAudit: async (_tenant, filter) => {
        exportedFilters.push(filter);
        return { id: "a".repeat(64), state: "ready", recordCount: 0, sha256: "b".repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString() };
      },
      auditExportContent: async (_tenant, _id, _request, canReadEvidence = false) => {
        downloadPermissions.push(canReadEvidence);
        if (!canReadEvidence) throw new WorkflowError("AUDIT_EVIDENCE_ACCESS_DENIED", 403);
        return bytes;
      },
      observeAuditExport: async () => {},
      searchAudit: async () => ({ data: [], pagination: { hasMore: false, nextCursor: null }, live: true }),
      auditDetail: async () => ({}),
    },
    recordWorkflowFailure: async (_tenant, event) => { failures.push(event.reasonCode ?? ""); return randomUUID(); },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/locations/${tenant.locationId}/audit`;
  const filter = { from: "2026-10-01T00:00:00Z", to: "2026-10-02T00:00:00Z", purpose: "synthetic-security-review" };
  const post = (includeEvidence: unknown) => fetch(base + "/exports", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify({ ...filter, includeEvidence }) });
  try {
    for (const value of ["true", true]) {
      const response = await post(value);
      assert.equal(response.status, 403);
      assert.equal((await response.json() as any).error.code, "AUDIT_EVIDENCE_ACCESS_DENIED");
    }
    assert.equal(exportedFilters.length, 0); assert.equal(commandFilters.length, 0);
    assert.deepEqual(failures, ["AUDIT_EVIDENCE_ACCESS_DENIED", "AUDIT_EVIDENCE_ACCESS_DENIED"]);
    for (const value of ["false", false]) {
      const response = await post(value); assert.equal(response.status, 201);
      assert.equal(exportedFilters.at(-1)?.includeEvidence, false);
      assert.equal(exportedFilters.at(-1), commandFilters.at(-1));
    }
    const malformed = await post(["true"]); assert.equal(malformed.status, 422);
    assert.equal(exportedFilters.length, 2);
    permissions = [...permissions, "org:audit:evidence:read"];
    for (const value of ["true", true]) {
      const response = await post(value); assert.equal(response.status, 201);
      assert.equal(exportedFilters.at(-1)?.includeEvidence, true);
      assert.equal(exportedFilters.at(-1), commandFilters.at(-1));
    }
    let response = await fetch(base + "/exports/" + "a".repeat(64) + "/content", { headers: { "X-Audit-Purpose": filter.purpose } });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    permissions = permissions.filter(permission => permission !== "org:audit:evidence:read");
    response = await fetch(base + "/exports/" + "a".repeat(64) + "/content", { headers: { "X-Audit-Purpose": filter.purpose } });
    assert.equal(response.status, 403); assert.equal((await response.json() as any).error.code, "AUDIT_EVIDENCE_ACCESS_DENIED");
    assert.deepEqual(downloadPermissions, [true, false]);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
