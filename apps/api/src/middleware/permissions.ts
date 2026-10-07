import type { RequestHandler } from "express";

export type ClinicalCapabilities = {
  patients: { read: boolean; create: boolean };
  appointments: { read: boolean; create: boolean };
};

export type AuthorizationContext = {
  isAuthenticated: boolean;
  orgId?: string | null;
  orgRole?: string | null;
  has?: (query: { permission: string }) => boolean;
};

/** Permissions come only from the verified Clerk session, never request data. */
export function clinicalCapabilities(auth: AuthorizationContext): ClinicalCapabilities {
  const active = auth.isAuthenticated && Boolean(auth.orgId);
  const administrator = active && auth.orgRole === "org:admin";
  const member = active && auth.orgRole === "org:member";
  const allows = (resource: "patients" | "appointments", operation: "read" | "create") => {
    if (!active) return false;
    if (administrator) return true;
    if (member) return operation === "read";
    return auth.has?.({ permission: `org:${resource}:${operation}` }) === true;
  };
  return {
    patients: { read: allows("patients", "read"), create: allows("patients", "create") },
    appointments: { read: allows("appointments", "read"), create: allows("appointments", "create") },
  };
}

export function requireClinicalPermission(
  resource: keyof ClinicalCapabilities,
  operation: "read" | "create",
): RequestHandler {
  return (_req, res, next) => {
    if (!res.locals.capabilities?.[resource]?.[operation]) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "You do not have permission to perform this action." } });
      return;
    }
    next();
  };
}
