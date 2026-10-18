import { catalogs, type MessageValues } from "../../../../../packages/i18n";
export { localizeNotice as localizeAccessText } from "@/i18n/notice";
type Translator = (key: string, values?: MessageValues) => string;
export function accessRoleLabel(t: Translator, role: string): string {
  if (role === "org:admin" || role === "admin") return t("access.copy.administrator");
  if (role === "owner") return t("access.copy.practice_owner");
  if (role === "org:member" || role === "member") return t("access.copy.team_member");
  return t("access.role.custom", { code: role });
}
const statusKeys: Record<string, string> = {
  active: "active", closed: "closed", invited: "invited", sending: "sending", pending: "pending_assignment", pending_assignment: "pending_assignment", suspended: "suspended", revoked: "revoked", scheduled: "scheduled", confirmed: "confirmed", checked_in: "checked_in", in_progress: "in_progress", completed: "completed", cancelled: "cancelled", canceled: "cancelled", no_show: "no_show", succeeded: "success", success: "success", failed: "failure", failure: "failure", denied: "denied", staff: "staff", user: "staff", patient_session: "patient_session", system: "system", unknown: "unknown", accepted: "accepted", job: "system", service: "system", anonymous: "anonymous",
};
export function accessStatusLabel(t: Translator, status: string | null | undefined): string { return t(status && statusKeys[status] ? `access.copy.${statusKeys[status]}` : "common.unknownLabel"); }
/** Codes stay visible for audit investigation; only the human label is translated. */
export function accessAuditLabel(t: Translator, kind: "action" | "field" | "entity" | "reason" | "actor" | "outcome", code: string): string {
  if (kind === "actor" || kind === "outcome") return accessStatusLabel(t, code);
  const key = `access.audit.${kind}.${code}`;
  const exists = Object.prototype.hasOwnProperty.call(catalogs.en, key);
  return exists ? t(key) : t(`access.audit.${kind}Unknown`);
}
export function accessZoneLabel(locale: string, zone: string): string {
  try { return new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "long" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value || zone; } catch { return zone; }
}
