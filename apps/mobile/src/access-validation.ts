import { ApiError } from "./api";
import type { AccessContext } from "./contracts";
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function nullableText(value: unknown): boolean { return value === null || text(value); }
function permissions(value: unknown): boolean { return object(value) && typeof value.read === "boolean" && typeof value.create === "boolean"; }
export function readAccessContext(value: unknown, identity: { userId: string; orgId: string | null; sessionId: string }): AccessContext {
  const invalid = () => { throw new ApiError("INVALID_ACCESS_RESPONSE", 503, "Your account access could not be confirmed. Please try again."); };
  if (!object(value)) return invalid();
  if (value.userId !== identity.userId || value.orgId !== identity.orgId || value.sessionId !== identity.sessionId) return invalid();
  if (!["required", "pending", "ready"].includes(String(value.onboarding)) || !nullableText(value.enrollmentStatus)) return invalid();
  if (value.onboardingOrgId !== undefined && !nullableText(value.onboardingOrgId)) return invalid();
  if (!object(value.management) || typeof value.management.locations !== "boolean" || typeof value.management.members !== "boolean") return invalid();
  if (!object(value.capabilities) || !permissions(value.capabilities.patients) || !permissions(value.capabilities.appointments)) return invalid();
  const practice = value.practice;
  if (practice !== null && (!object(practice) || !text(practice.id) || !text(practice.name) || !text(practice.status) || !text(practice.authorizationMode) || !nullableText(practice.ownerUserId))) return invalid();
  if (!Array.isArray(value.locations) || !value.locations.every(location => object(location) && text(location.id) && text(location.name) && text(location.timeZone) && (location.address === null || typeof location.address === "string") && text(location.status))) return invalid();
  return value as AccessContext;
}
