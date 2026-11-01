import type { WorkflowAppointment } from "./api/workflow";

/** A date key in the practice's zone, never the workstation's zone. */
export function practiceDateKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function isActiveVisit(visit: WorkflowAppointment) { return !["cancelled", "completed", "no_show"].includes(visit.status); }
export function nextVisitStatus(visit: WorkflowAppointment): string | null {
  return ({ scheduled: "checked_in", confirmed: "checked_in", checked_in: "in_progress", in_progress: "completed" } as Record<string, string>)[visit.status] ?? null;
}
export function visitReadinessTone(visit: WorkflowAppointment): "ready" | "attention" | "unknown" {
  const readiness = visit.readiness;
  if (!readiness) return "unknown";
  const state = readiness.status ?? readiness.state;
  if (["ready", "complete", "not_required"].includes(state ?? "")) return "ready";
  if (state && state !== "unknown" || (readiness.missingCount ?? readiness.missing ?? 0) > 0 || (readiness.needsReviewCount ?? readiness.pendingReview ?? 0) > 0) return "attention";
  return "unknown";
}
