import { randomUUID } from "node:crypto";
import type { Express, Request } from "express";
import type { RequestAuthentication, TenantContext } from "../middleware/tenant-context.js";
import type { PracticeAccess } from "./practice-access.js";
import { logFailure } from "../logging.js";
import { WorkflowError } from "../workflow/policy.js";

export function registerProtectedAuditRoutes(app: Express, getAuth: (req: Request) => RequestAuthentication, access: PracticeAccess) {
  const base = "/api/v1/locations/:locationId/audit";
  for (const [method, suffix, operation] of [["get", "/events", "search"], ["get", "/events/:eventId", "detail"], ["post", "/exports", "export"], ["get", "/exports/:exportId/content", "download"]] as const) {
    app[method](`${base}${suffix}`, async (req, res) => {
      const requestId = randomUUID(); res.setHeader("X-Request-Id", requestId); res.setHeader("Cache-Control", "no-store");
      let tenant: TenantContext | undefined;
      const auth = getAuth(req);
      try {
        const { currentMembership } = await import("../services/clerk-directory.js");
        const { command } = await import("../workflow/transaction.js");
        const { auditDetail, auditExportContent, exportAudit, parseAuditFilter, searchAudit, observeAuditExport } = await import("../services/protected-audit.service.js");
        const context = await access.authorizeLocation(auth, String(req.params.locationId)); tenant = context.tenant;
        const membership = await currentMembership(tenant.orgId, tenant.userId);
        const permission = operation === "export" || operation === "download" ? "org:audit:export" : "org:audit:read";
        if (!membership || membership.id !== tenant.membershipId || !membership.permissions.includes(permission)) throw new WorkflowError("AUDIT_ACCESS_DENIED", 403);
        const includeEvidence = req.query.includeEvidence === "true" || req.body?.includeEvidence === true;
        if (includeEvidence && !membership.permissions.includes("org:audit:evidence:read")) throw new WorkflowError("AUDIT_EVIDENCE_ACCESS_DENIED", 403);
        const purpose = req.get("X-Audit-Purpose") || (typeof req.body?.purpose === "string" ? req.body.purpose : "");
        if (purpose.trim().length < 3 || purpose.length > 96 || /[\u0000-\u001f]/.test(purpose)) throw new WorkflowError("AUDIT_PURPOSE_REQUIRED", 422, { message: "Provide a bounded audit purpose or case reference." });
        if (operation === "search") res.json(await searchAudit(tenant, parseAuditFilter(req.query), requestId, purpose));
        if (operation === "detail") res.json({ data: await auditDetail(tenant, String((req.params as Record<string, string>).eventId), requestId, purpose, includeEvidence) });
        if (operation === "export") res.status(201).json({ data: await command(tenant, "audit.export", "", { filter: parseAuditFilter(req.body), purpose }, { requestId, idempotencyKey: req.get("Idempotency-Key") }, () => exportAudit(tenant!, parseAuditFilter(req.body), requestId, purpose, req.get("Idempotency-Key") || "")) });
        if (operation === "download") {
          const bytes = await auditExportContent(tenant, String((req.params as Record<string, string>).exportId), requestId);
          res.setHeader("Content-Disposition", 'attachment; filename="careiq-audit-export.json"');
          let completed = false;
          res.on("finish", () => { completed = true; void observeAuditExport(tenant!, String((req.params as Record<string, string>).exportId), requestId, bytes.length).catch(error => logFailure("Audit export transfer evidence failed", error)); });
          res.on("close", () => { if (!completed) void observeAuditExport(tenant!, String((req.params as Record<string, string>).exportId), requestId, 0, false).catch(error => logFailure("Audit export disconnect evidence failed", error)); });
          res.type("application/json").send(bytes);
        }
      } catch (error) {
        const status = error instanceof WorkflowError ? error.status : typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503;
        const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : error instanceof WorkflowError ? error.code : "AUDIT_UNAVAILABLE";
        try { const { recordWorkflowFailure } = await import("../services/workflow-audit.js"); await recordWorkflowFailure(tenant || { practiceId: "", userId: auth.userId || "", locationId: "" }, { action: "audit.access.failed", entityType: "audit", requestId, outcome: status === 403 || status === 401 ? "denied" : "failed", reasonCode: code, actorType: auth.userId ? "user" : "anonymous" }); }
        catch { res.status(503).json({ error: { code: "AUDIT_UNAVAILABLE", message: "Protected audit access is unavailable.", requestId } }); return; }
        res.status(status).json({ error: { code, message: error instanceof WorkflowError && typeof error.details?.message === "string" ? error.details.message : "Protected audit access is unavailable.", requestId } });
      }
    });
  }
}
