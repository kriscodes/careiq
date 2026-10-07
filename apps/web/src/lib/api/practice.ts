import { apiRequest } from "./client";
import type { PracticeCapabilities } from "../capabilities";

export type Location = { id: string; name: string; timeZone: string; address?: string | null; status?: "active" | "closed" };
export type AccessContext = {
  userId: string;
  orgId: string | null;
  practice: { id: string; name: string; authorizationMode: "legacy" | "location"; status: string } | null;
  onboarding: "required" | "pending" | "ready";
  onboardingOrgId?: string | null;
  enrollmentStatus: string | null;
  capabilities: PracticeCapabilities;
  management: { locations: boolean; members: boolean };
  locations: Location[];
};
export type PracticeMember = { userId: string; membershipId: string; displayName?: string | null; email?: string | null; status: string; role: string | null; locationIds: string[]; proposedLocationIds?: string[]; isOwner: boolean };
export type PracticeInvitation = { id: string; email: string; role: string; status: string; locationIds: string[]; expiresAt: string | null; providerRevocationPending?: boolean };
export type PracticeAdmin = { locations: Location[]; members: PracticeMember[]; invitations: PracticeInvitation[]; allowedRoles: string[] };

export type ClinicalScope = { kind: "blocked" } | { kind: "legacy" } | { kind: "location"; locationId: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Navigation guard only; the API independently authorizes every operation. */
export function resolveClinicalScope(context: AccessContext, locationId: string): ClinicalScope {
  if (!context.orgId || !context.practice || context.practice.status !== "active" || context.onboarding !== "ready") return { kind: "blocked" };
  if (context.practice.authorizationMode === "legacy") return { kind: "legacy" };
  if (context.practice.authorizationMode !== "location" || context.enrollmentStatus !== "active" || !uuid.test(locationId)) return { kind: "blocked" };
  const location = context.locations?.find(item => item.id === locationId);
  if (!location || (location.status !== undefined && location.status !== "active")) return { kind: "blocked" };
  return { kind: "location", locationId };
}

export async function getAccessContext(token: string, signal?: AbortSignal) {
  return (await apiRequest<{ data: AccessContext }>("/api/v1/me", token, { signal })).data;
}

/** Keep the explicit location in the URL, including every page and retry. */
export function clinicalPath(resource: "patients" | "appointments", locationId?: string) {
  if (locationId !== undefined && !uuid.test(locationId)) {
    throw new Error("Choose a valid location before opening records.");
  }
  return locationId === undefined ? `/api/v1/${resource}` : `/api/v1/locations/${locationId}/${resource}`;
}
