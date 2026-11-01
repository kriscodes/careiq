import type { OwnerAccessProfile } from "./api/practice";

export const OWNER_ACCESS_AREAS = [
  { id: "patients", permissions: ["org:patients:read", "org:patients:create", "org:patients:update"] },
  { id: "appointments", permissions: ["org:appointments:read", "org:appointments:create", "org:appointments:update"] },
  { id: "documents", permissions: ["org:documents:read", "org:documents:upload", "org:documents:review", "org:documents:archive", "org:requests:send", "org:requirements:waive", "org:requirements:manage"] },
  { id: "work", permissions: ["org:work:manage", "org:activity:read"] },
  { id: "templates", permissions: ["org:workflow:configure"] },
  { id: "patientAccounts", permissions: ["org:paperwork:manage"] },
] as const;
export const OWNER_ACCESS_PERMISSIONS: readonly string[] = OWNER_ACCESS_AREAS.flatMap(area => [...area.permissions]);
export const PAPERWORK_PERMISSION = "org:paperwork:manage";
export function canManagePatientAccounts(disabledPermissions: readonly string[]) {
  return !disabledPermissions.includes("org:documents:read") && !disabledPermissions.includes("org:workflow:configure");
}
export function readOwnerAccessProfile(value: unknown): OwnerAccessProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as Partial<OwnerAccessProfile>;
  if (!Array.isArray(profile.disabledPermissions) || profile.disabledPermissions.some(permission => typeof permission !== "string" || !OWNER_ACCESS_PERMISSIONS.includes(permission)) || typeof profile.allLocations !== "boolean" || !Number.isSafeInteger(profile.revision) || profile.revision! < 0) return null;
  return { disabledPermissions: [...new Set(profile.disabledPermissions)].sort(), allLocations: profile.allLocations, revision: profile.revision! };
}
