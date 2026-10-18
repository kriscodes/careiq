import { translate } from "../../../../../packages/i18n";
import type { Readiness } from "@/lib/api/workflow";

type Locale = Parameters<typeof translate>[0];
const statuses = new Set([
  "not_applicable", "clinician_directed", "patient_declined", "entered_in_error", "policy_change", "new_evidence_needed", "duplicate", "superseded", "archived_in_error", "needed_for_care", "no_longer_needed", "patient_requested", "provider_unavailable", "scheduling_error", "other",
  "scheduled", "confirmed", "checked_in", "in_progress", "completed", "cancelled", "no_show",
  "ready", "not_required", "needs_review", "needs_attention", "not_ready", "incomplete", "satisfied", "waived", "missing",
  "available", "processing", "quarantined", "rejected_scan", "reserved", "accepted", "denied", "replacement_required", "rejected", "archived",
  "draft", "published", "retired", "superseded", "active", "inactive", "open", "pending", "partially_completed", "partially_fulfilled",
  "delivered", "failed", "queued", "sent", "bounced", "complained", "suppressed", "succeeded", "expired", "declined", "revoked", "fulfilled", "submitted", "received",
  "disabled", "collection", "signature", "email", "document_review", "document_collection", "missing_document", "collect_document", "request_follow_up", "request_delivery_failed", "scan_failure", "replacement", "reminder", "unreviewed", "unknown",
  "readiness_changed", "patient_created", "patient_updated", "appointment_created", "appointment_updated", "document_uploaded", "document_reviewed", "request_created", "requirement_waived", "waiver_revoked",
]);

export function workflowStatus(locale: Locale, code?: string | null) {
  return translate(locale, `workflow.status.${code && statuses.has(code) ? code : "unknown"}`);
}

export function workflowReadiness(locale: Locale, readiness?: Readiness) {
  if (!readiness) return translate(locale, "workflow.readiness.unavailable");
  const state = readiness.state ?? readiness.status;
  if (state === "ready" || state === "complete") return translate(locale, "workflow.readiness.ready");
  if (state === "not_required") return translate(locale, "workflow.readiness.notRequired");
  if (state === "needs_review" || readiness.pendingReview || readiness.needsReviewCount) return translate(locale, "workflow.readiness.review");
  return translate(locale, "workflow.readiness.attention");
}

export function workflowDate(locale: Locale, value: string | null | undefined, zone: string, includeDate = false) {
  if (!value) return translate(locale, "workflow.text.notSet");
  return new Intl.DateTimeFormat(locale, { ...(includeDate ? { month: "short", day: "numeric" } as const : {}), hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(value));
}

export class WorkflowInputError extends Error {}

const activities: Record<string, string> = {
  "patients.create": "workflow.activity.1",
  "patients.update": "workflow.activity.2",
  "appointments.create": "workflow.activity.3",
  "appointments.update": "workflow.activity.4",
  "appointments.status": "workflow.activity.5",
  "appointments.cancellation": "workflow.activity.6",
  "requirements.reconciliation": "workflow.activity.7",
  "requirements.waiver": "workflow.activity.8",
  "requirements.waiver-revocation": "workflow.activity.9",
  "requirements.evidence": "workflow.activity.10",
  "providers.create": "workflow.activity.11",
  "providers.update": "workflow.activity.12",
  "providers.availability": "workflow.activity.13",
  "providers.assignment": "workflow.activity.14",
  "visit-types.create": "workflow.activity.15",
  "document-types.create": "workflow.activity.16",
  "rules.publication": "workflow.activity.17",
  "documents.current-version": "workflow.activity.18",
  "documents.archive": "workflow.activity.19",
  "documents.restore": "workflow.activity.20",
  "documents.review": "workflow.activity.21",
  "templates.create": "workflow.activity.22",
  "templates.update": "workflow.activity.23",
  "templates.versions": "workflow.activity.24",
  "templates.version-update": "workflow.activity.25",
  "templates.publication": "workflow.activity.26",
  "templates.preparation": "workflow.activity.27",
  "uploads.reservation": "workflow.activity.28",
  "uploads.completion": "workflow.activity.29",
  "requests.create": "workflow.activity.30",
  "requests.reminders": "workflow.activity.31",
  "requests.reissue": "workflow.activity.32",
  "requests.cancellation": "workflow.activity.33",
  "work-items.assignment": "workflow.activity.34",
  "work-items.completion": "workflow.activity.35"
};

export function workflowActivity(locale: Locale, code?: string | null) {
  const operation = (code ?? "").replace(/\.(accepted|replay)$/, "");
  return translate(locale, activities[operation] ?? "workflow.activity.recorded");
}
