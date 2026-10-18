import type { Express, Request, RequestHandler, Response } from "express";
import type { RequestAuthentication } from "../middleware/tenant-context.js";
import type { practiceAccess } from "../services/practice-access.service.js";
import { AccessError } from "../services/practice-policy.js";
import { parseIdempotencyKey } from "../validation.js";
import { logFailure } from "../logging.js";

export type PracticeAccess = typeof practiceAccess;
export function accessFailure(res: Response, error: unknown) {
  if (error instanceof AccessError) { res.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
  logFailure("Practice operation failed", error);
  res.status(503).json({ error: { code: "PRACTICE_OPERATION_UNAVAILABLE", message: "Unable to complete this operation. Retry with the same details." } });
}

/** New setup endpoints expose readable copy without provider/database error messages. */
function onboardingFailure(res: Response, error: unknown) {
  if (!(error instanceof AccessError)) { accessFailure(res, error); return; }
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "Sign in again to continue.",
    ACCOUNT_UNAVAILABLE: "This account is unavailable. Use another account or contact support.",
    AUTHORIZATION_UNAVAILABLE: "We couldn’t verify your account. Please try again.",
    VERIFIED_EMAIL_REQUIRED: "Verify your email address before setting up a practice.",
    ONBOARDING_NOT_ELIGIBLE: "This account has not been approved to create a practice.",
    INVALID_REQUEST: "Check your practice setup details and try again.",
    INVALID_ONBOARDING_DRAFT: "Check the practice setup fields and their lengths.",
    INVALID_ONBOARDING_STEP: "Choose a valid setup step and try again.",
    INVALID_TIME_ZONE: "Choose a valid time zone.",
    ONBOARDING_IN_PROGRESS: "Practice setup was already submitted. Resume the original setup.",
    ONBOARDING_ALREADY_COMPLETE: "Your practice is already created. Open it to continue.",
  };
  res.status(error.status).json({ error: { code: error.code, message: messages[error.code] ?? "We couldn’t update your practice setup. Please try again." } });
}
export function registerPracticeRoutes(app: Express, access: PracticeAccess, getAuth: (req: Request) => RequestAuthentication) {
  const route = (operation: (req: Request) => Promise<unknown>, status = 200, failure = accessFailure): RequestHandler => async (req, res) => {
    try { res.status(status).json({ data: await operation(req) }); } catch (error) { failure(res, error); }
  };
  const body = (req: Request) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw new AccessError("INVALID_REQUEST", 400);
    return req.body as Record<string, unknown>;
  };
  const key = (req: Request) => {
    const value = parseIdempotencyKey(req.get("Idempotency-Key"));
    if (!value) throw new AccessError("IDEMPOTENCY_KEY_REQUIRED", 400, "Idempotency-Key must be a UUID version 4.");
    return value;
  };
  const param = (req: Request, name: string) => String(req.params[name]);
  app.get("/api/v1/onboarding/state", route((req) => access.getOnboardingState(getAuth(req)), 200, onboardingFailure));
  app.put("/api/v1/onboarding/draft", route((req) => access.saveOnboardingDraft(getAuth(req), body(req)), 200, onboardingFailure));
  app.post("/api/v1/onboarding", route((req) => access.onboard(getAuth(req), body(req), key(req)), 201));
  app.get("/api/v1/practice/admin", route((req) => access.admin(getAuth(req))));
  app.post("/api/v1/locations", route((req) => access.createLocation(getAuth(req), body(req)), 201));
  app.post("/api/v1/locations/:locationId/status", route((req) => access.setLocationStatus(getAuth(req), param(req, "locationId"), body(req).status)));
  app.post("/api/v1/practice/invitations", route((req) => access.createInvitation(getAuth(req), body(req), key(req)), 201));
  app.post("/api/v1/practice/invitations/accept", route((req) => access.acceptInvitations(getAuth(req))));
  app.post("/api/v1/practice/invitations/:id/revoke", route((req) => access.revokeInvitation(getAuth(req), param(req, "id"))));
  app.post("/api/v1/practice/members/:userId/activate", route((req) => access.activateMember(getAuth(req), param(req, "userId"), body(req))));
  app.post("/api/v1/practice/members/:userId/suspend", route((req) => access.suspendMember(getAuth(req), param(req, "userId"))));
  app.post("/api/v1/practice/ownership", route((req) => access.transferOwnership(getAuth(req), String(body(req).userId ?? ""))));
}
