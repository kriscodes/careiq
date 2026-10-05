import type { ClinicalCapabilities } from "../middleware/permissions.js";

export class AccessError extends Error {
  constructor(public code: string, public status = 403, message = code.replaceAll("_", " ")) { super(message); }
}
export type CurrentMembership = { id: string; userId: string; role: string; permissions: string[]; displayName?: string; email?: string };
export function currentCapabilities(membership: CurrentMembership | null): ClinicalCapabilities {
  const has = (permission: string) => membership?.permissions.includes(permission) === true;
  return {
    patients: { read: has("org:patients:read"), create: has("org:patients:create") },
    appointments: { read: has("org:appointments:read"), create: has("org:appointments:create") },
  };
}
export function assertCurrentEnrollment(member: { status: string; membership_id: string } | undefined, membership: CurrentMembership | null) {
  if (!membership || !member || member.status !== "active" || member.membership_id !== membership.id) throw new AccessError("ENROLLMENT_REQUIRED");
}
export function assertOwner(practice: { owner_user_id: string | null }, userId: string, membership: CurrentMembership | null) {
  if (practice.owner_user_id !== userId || membership?.role !== "org:admin") throw new AccessError("OWNER_REQUIRED");
}
export function allowedRoles(environment = process.env): string[] {
  return [...new Set(["org:member", "org:admin", ...(environment.CAREIQ_STAFF_ROLES ?? "").split(",").map((role) => role.trim()).filter((role) => /^org:[a-z][a-z0-9_]{0,63}$/.test(role))])];
}
export function assertRoleGrant(actorUserId: string, targetUserId: string, currentRole: string, requestedRole: unknown, roles: string[]) {
  if (typeof requestedRole !== "string" || !roles.includes(requestedRole)) throw new AccessError("ROLE_NOT_ALLOWED");
  if (actorUserId === targetUserId && currentRole !== requestedRole) throw new AccessError("SELF_ROLE_CHANGE_FORBIDDEN");
}
export function parseLocation(input: unknown): { name: string; timeZone: string; address: string | null } {
  if (!input || typeof input !== "object") throw new AccessError("INVALID_LOCATION", 400);
  const { name, timeZone, address } = input as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120 || typeof timeZone !== "string" || timeZone.length > 80 || /[\u0000-\u001f]/.test(name)) throw new AccessError("INVALID_LOCATION", 400);
  try { new Intl.DateTimeFormat("en-US", { timeZone }); } catch { throw new AccessError("INVALID_TIME_ZONE", 400); }
  if (address !== undefined && address !== null && (typeof address !== "string" || address.length > 500 || /[\u0000-\u001f]/.test(address))) throw new AccessError("INVALID_ADDRESS", 400);
  return { name: name.trim(), timeZone, address: typeof address === "string" ? address.trim() || null : null };
}
export function parseLocationIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) throw new AccessError("INVALID_LOCATIONS", 400);
  return [...new Set(value.map((id: string) => id.toLowerCase()))];
}
