// A link selects a screen; Clerk membership and the API still decide authority.
export function invitationConfirmation(value: string | string[] | undefined, activeOrganization: string | null | undefined): "none" | "confirm" | "wrong-practice" {
  if (value === undefined) return "none";
  if (typeof value !== "string" || value.length > 160 || !/^org_[A-Za-z0-9_-]+$/.test(value)) return "wrong-practice";
  return value === activeOrganization ? "confirm" : "wrong-practice";
}
export function authenticationDestination(value: string | string[] | undefined): "/" | "/join" {
  // Never navigate to an external URI or replay a caller-controlled confirmation parameter.
  return value === "/join" ? "/join" : "/";
}
