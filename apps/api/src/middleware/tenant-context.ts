import type { NextFunction, Request, Response } from "express";
import { logFailure } from "../logging.js";
import { clinicalCapabilities, type AuthorizationContext } from "./permissions.js";

export type TenantContext = {
  userId: string;
  orgId: string;
  practiceId: string;
};

export type RequestAuthentication = AuthorizationContext & {
  userId?: string | null;
  sessionId?: string | null;
};

export function createTenantContextMiddleware(dependencies: {
  getAuth: (request: Request) => RequestAuthentication;
  findPracticeByClerkOrgId: (orgId: string) => Promise<{ id: string } | null>;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = dependencies.getAuth(req);
      if (!auth.isAuthenticated || !auth.userId) {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      if (!auth.orgId) {
        res.status(403).json({ error: { code: "ORGANIZATION_REQUIRED", message: "An active organization is required." } });
        return;
      }
      const practice = await dependencies.findPracticeByClerkOrgId(auth.orgId);
      if (!practice) {
        res.status(403).json({ error: { code: "PRACTICE_NOT_FOUND", message: "No CareIQ practice is associated with this organization." } });
        return;
      }
      res.locals.tenant = { userId: auth.userId, orgId: auth.orgId, practiceId: practice.id };
      res.locals.capabilities = clinicalCapabilities(auth);
      next();
    } catch (error) {
      logFailure("Failed to establish tenant context", error);
      res.status(500).json({ error: { code: "TENANT_CONTEXT_ERROR", message: "Unable to establish tenant context." } });
    }
  };
}
