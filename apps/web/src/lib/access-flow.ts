/** Restrict restored destinations to the app. Never accept an arbitrary redirect. */
export function safeDestination(value: string | null | undefined): string {
  if (value === "/" || value === "/?invitations=1" || value === "/?onboarding=1" || value === "/join" || value === "/join?accepted=1") return value;
  const match = value?.match(/^\/join\?confirm=(org_[A-Za-z0-9]{1,100})$/);
  if (match) return `/join?confirm=${match[1]}`;
  return "/";
}

/** A resume hint only; it never proves an organization membership. */
export function invitationOrganizationHint(value: string | undefined) {
  return value && /^org_[A-Za-z0-9]{1,100}$/.test(value) ? value : undefined;
}

export type AuthStep = "signin" | "signup" | "verify" | "forgot" | "resetcode" | "reset" | "mfa" | "recovery" | "firstcode" | "provider";
export function signInStep(status: string, factors: readonly { strategy: string }[] = []): AuthStep | "complete" {
  if (status === "complete") return "complete";
  if (status === "needs_new_password") return "reset";
  if (status === "needs_second_factor" && factors.some(f => ["totp", "phone_code", "email_code", "backup_code"].includes(f.strategy))) return "mfa";
  // Device trust, mid-flow bot challenges, and additional factors stay provider-owned.
  return "provider";
}
export function invitationEmailMatches(emails: readonly string[], invitationEmail: string) {
  return emails.some(email => email.trim().toLowerCase() === invitationEmail.trim().toLowerCase());
}

export type PracticeDraft = { practiceName: string; locationName: string; timeZone: string; address: string; step: 1 | 2 | 3 };
export type OnboardingState = { eligible: boolean; emailVerified: boolean; draft: PracticeDraft | null; operation: { state: "pending" | "complete"; practiceId: string | null; organizationId: string | null } | null };
export function onboardingView(state: OnboardingState): "verify" | "restricted" | "pending" | "complete" | "draft" {
  if (state.operation) return state.operation.state;
  if (!state.emailVerified) return "verify";
  return state.eligible ? "draft" : "restricted";
}
export function onboardingInput(draft: PracticeDraft) {
  return { name: draft.practiceName.trim(), location: { name: draft.locationName.trim(), timeZone: draft.timeZone, ...(draft.address.trim() ? { address: draft.address.trim() } : {}) } };
}
export function validateDraft(draft: PracticeDraft, final = false): string | null {
  if ((final || draft.step > 1) && !draft.practiceName.trim()) return "Enter your practice name.";
  if ((final || draft.step > 2) && !draft.locationName.trim()) return "Enter a location name.";
  if (draft.practiceName.trim().length > 120 || draft.locationName.trim().length > 120 || draft.address.length > 500) return "Keep the name under 120 characters and address under 500.";
  try { new Intl.DateTimeFormat("en-US", { timeZone: draft.timeZone }); } catch { return "Choose a valid time zone."; }
  return null;
}
export function timeZoneLabel(zone: string) {
  const common: Record<string, string> = { "America/Los_Angeles": "Pacific Time (US & Canada)", "America/Denver": "Mountain Time (US & Canada)", "America/Chicago": "Central Time (US & Canada)", "America/New_York": "Eastern Time (US & Canada)" };
  return common[zone] || zone.replaceAll("_", " ").replace("/", " · ");
}

/** Keep setup usable in browsers without the optional exhaustive Intl zone list. */
export function availableTimeZones(current: string): string[] {
  let zones: string[] = [];
  try { if (typeof Intl.supportedValuesOf === "function") zones = Intl.supportedValuesOf("timeZone"); } catch { /* Use valid common zones below. */ }
  return [...new Set([current, "UTC", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", ...zones])];
}
