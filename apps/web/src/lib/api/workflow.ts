import { apiRequest, ApiError } from "./client";
import { apiRequestUrl } from "../web-config";
import { translate } from "../../../../../packages/i18n";

export type Concurrency = { revision: number; ifMatch: string };
export type WorkflowRecord = { id: string; revision?: number; concurrency?: Concurrency; allowedActions?: string[] };
export type WorkflowPatient = WorkflowRecord & { firstName: string; lastName: string; email: string | null; phone: string | null; dateOfBirth?: string | null; preferredContactMethod?: string; status?: string };
export type Requirement = WorkflowRecord & { patientId?: string; appointmentId?: string; labelSnapshot?: string; progressState?: string; lifecycleState?: string; label?: string; name?: string; documentTypeId?: string; state?: string; status?: string; reason?: string; reasonCodes?: string[]; reviewRequired?: boolean; signatureRequired?: boolean; candidateVersionId?: string | null; candidateDocumentId?: string | null; selectedEvidence?: { id?: string; documentId?: string | null; documentVersionId: string; acceptedReviewId?: string | null } | null; evidenceVersionId?: string | null; documentVersionId?: string | null };
export type Readiness = { requiredCount?: number; satisfiedCount?: number; waivedCount?: number; needsReviewCount?: number; missingCount?: number; state?: string; status?: string; ready?: number; total?: number; satisfied?: number; missing?: number; pendingReview?: number; label?: string };
export type WorkflowAppointment = WorkflowRecord & { patientId: string; providerId?: string | null; visitTypeId?: string | null; scheduledAt: string; endsAt?: string | null; durationMinutes?: number; status: string; reason: string | null; patient?: WorkflowPatient; provider?: { id: string; name?: string; displayName?: string }; readiness?: Readiness; requirements?: Requirement[] };
export type DocumentVersion = WorkflowRecord & { versionNumber?: number; originalFilename?: string; contentType?: string; review?: { decision: string; id?: string } | null; fileName?: string; mimeType?: string; sizeBytes?: number; createdAt?: string; scanStatus?: string; reviewStatus?: string; status?: string; contentHash?: string };
export type WorkflowDocument = WorkflowRecord & { patientId: string; documentTypeId?: string; title?: string; name?: string; status?: string; reviewStatus?: string; scanStatus?: string; archivedAt?: string | null; currentVersionId?: string | null; candidateVersionId?: string | null; currentVersion?: DocumentVersion | null; candidateVersion?: DocumentVersion | null; versions?: DocumentVersion[]; createdAt?: string; updatedAt?: string };
export type TemplateField = { id?: string; key: string; label: string; type: string; required?: boolean; options?: string[]; sectionId?: string; helpText?: string; placeholder?: string; signerRole?: string; maxLength?: number; min?: number; max?: number };
export type FormRule = { id: string; targetFieldKey: string; sourceFieldKey: string; operator: "equals" | "not_equals" | "checked" | "not_checked" | "has_value"; value?: string | boolean | number };
export type FormSection = { id: string; title: string; description?: string; repeatable?: boolean; minItems?: number; maxItems?: number };
export type FormSchema = { documentTitle?: string; mode: "guided"; defaultLocale: "en" | "es"; completionPolicy: "form_only" | "form_then_sign"; sections: FormSection[]; rules: FormRule[]; bindings: Array<{ fieldKey: string; destination: "patient.preferredName" | "patient.email" | "patient.phone" | "patient.dateOfBirth"; reviewRequired: true }>; signing: { roles: Array<{ key: string; label: string; required: boolean }>; consentText: string; consentTextVersion: string }; delivery: { emailCopy: boolean } };
export type TemplateVersion = WorkflowRecord & { versionNumber?: number; state?: string; fieldSchema?: TemplateField[]; schemaVersion?: number; formSchema?: FormSchema; status?: string; fields?: TemplateField[]; content?: string; contentHash?: string; publishedAt?: string };
export type WorkflowTemplate = WorkflowRecord & { name: string; title?: string; description?: string; documentTypeId?: string; status?: string; version?: number; versionId?: string; publishedVersionId?: string | null; fields?: TemplateField[]; content?: string; versions?: TemplateVersion[] };
export type WorkflowRequest = WorkflowRecord & { patientId: string; appointmentId?: string | null; purpose?: string; state?: string; status: string; recipientName?: string; recipientChannel?: string; deliveryState?: string; recipientEmail?: string; recipient?: { email?: string; name?: string }; dueAt?: string | null; expiresAt?: string | null; deliveryStatus?: string; items?: Array<{ requirementId?: string; documentTypeId?: string; templateVersionId?: string; label?: string; status?: string }>; patientUrl?: string; localReviewPath?: string };
export type WorkItem = WorkflowRecord & { patientId?: string; appointmentId?: string; documentId?: string; title?: string; kind: string; state?: string; status?: string; priority?: string; dueAt?: string | null; assigneeUserId?: string | null; assigneeId?: string | null };
export type Lookup = WorkflowRecord & { name: string; displayName?: string; defaultDurationMinutes?: number; durationMinutes?: number; status?: string };
export type WorkflowActivity = { id: string; action: string; createdAt?: string; occurredAt?: string; actorLabel?: string; summary?: string; outcome?: string };
export type WorkflowPagination = { hasMore: boolean; nextCursor: string | null; limit?: number; total?: number };
export type WorkflowSnapshot = { relatedPagination?: { documentVersions?: Record<string, WorkflowPagination>; templateVersions?: Record<string, WorkflowPagination> }; pagination?: Record<string, WorkflowPagination>; location?: { id: string; name: string; timeZone?: string }; timeZone: string; patients: WorkflowPatient[]; appointments: WorkflowAppointment[]; documents: WorkflowDocument[]; templates: WorkflowTemplate[]; requests: WorkflowRequest[]; workItems: WorkItem[]; providers: Lookup[]; visitTypes: Lookup[]; documentTypes: Lookup[]; summary?: Record<string, number>; capabilities?: Record<string, unknown>; asOf: string };
export type WorkflowAdapter = {
  preview?: boolean;
  load(date: string, signal?: AbortSignal, options?: { q?: string }): Promise<WorkflowSnapshot>;
  page<T>(resource: string, signal?: AbortSignal): Promise<{ data: T[]; pagination: WorkflowPagination }>;
  detail<T>(resource: string, signal?: AbortSignal): Promise<T>;
  command<T>(resource: string, body: unknown, options?: { method?: "POST" | "PATCH"; revision?: string; key?: string; signal?: AbortSignal }): Promise<T>;
  file(versionId: string, purpose?: string, signal?: AbortSignal): Promise<Blob>;
  templatePreview?(version: TemplateVersion, answers?: Record<string, unknown>, signal?: AbortSignal): Promise<Blob>;
  upload(patientId: string, file: File, input: Record<string, unknown>, key: string, signal?: AbortSignal): Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function workflowPath(locationId: string, resource = "") {
  if (!uuid.test(locationId)) throw new Error("Choose a valid location before opening records.");
  if (resource.startsWith("/") || resource.includes("..")) throw new Error("Invalid workflow resource.");
  return `/api/v1/locations/${locationId}/workflow${resource ? `${resource.startsWith("?") ? "" : "/"}${resource}` : ""}`;
}
export function concurrencyOf(record?: WorkflowRecord) { return record?.concurrency?.ifMatch ?? `"${record?.revision ?? 1}"`; }
export function patientName(patient?: WorkflowPatient, locale = "en") { return patient ? `${patient.firstName} ${patient.lastName}` : translate(locale,"common.patientUnavailable"); }
export function readinessLabel(readiness?: Readiness, locale = "en") {
  if (!readiness) return translate(locale,"workflow.readiness.unavailable");
  if (readiness.label) return readiness.label;
  const state = readiness.state ?? readiness.status;
  if (state === "ready" || state === "complete") return translate(locale,"workflow.readiness.ready");
  if (state === "not_required") return translate(locale,"workflow.readiness.notRequired");
  if (state === "needs_review" || readiness.pendingReview || readiness.needsReviewCount) return translate(locale,"workflow.readiness.review");
  return translate(locale,"workflow.readiness.attention");
}
export function allowed(record: WorkflowRecord | undefined, action: string, capabilities?: Record<string, unknown>) {
  if (record?.allowedActions) { const names: Record<string, string[]> = { "appointment.update": ["edit", "cancel"], "document.review": ["review"], "document.archive": ["archive", "restore"], "requirement.waive": ["waive", "revoke_waiver"], "request.send": ["remind", "reissue", "cancel"] }; return record.allowedActions.includes(action) || record.allowedActions.includes("*") || (names[action] ?? []).some(name => record.allowedActions!.includes(name)); }
  const keys: Record<string, string> = { "patient.create": "patientsCreate", "patient.update": "patientsUpdate", "appointment.create": "appointmentsCreate", "appointment.update": "appointmentsUpdate", "document.upload": "documentsUpload", "document.review": "documentsReview", "document.archive": "documentsArchive", "request.send": "requestsSend", "requirement.waive": "requirementsWaive", "configuration.manage": "configurationManage", "activity.read": "activityRead" };
  return capabilities?.[keys[action] ?? action] === true;
}
export function createWorkflowAdapter(locationId: string, getToken: () => Promise<string>, onAccessDenied: () => void): WorkflowAdapter {
  const uploadAttempts = new Map<string, { id: string; uploaded: boolean; completionKey: string }>();
  const request = async <T,>(resource: string, options: RequestInit = {}) => {
    try { return (await apiRequest<{ data: T }>(workflowPath(locationId, resource), await getToken(), options)).data; }
    catch (error) { if (error instanceof ApiError && [401, 403].includes(error.status) && error.code !== "RECENT_AUTHENTICATION_REQUIRED") onAccessDenied(); throw error; }
  };
  return {
    load: async (date, signal, options) => normalizeSnapshot(await request<WorkflowSnapshot>(`?date=${encodeURIComponent(date)}${options?.q ? `&q=${encodeURIComponent(options.q)}` : ""}`, { signal })),
    async page<T>(resource: string, signal?: AbortSignal) { try { return await apiRequest<{ data: T[]; pagination: WorkflowPagination }>(workflowPath(locationId, resource), await getToken(), { signal }); } catch (error) { if (error instanceof ApiError && [401,403].includes(error.status)) onAccessDenied(); throw error; } },
    detail: <T,>(resource: string, signal?: AbortSignal) => request<T>(resource, { signal }),
    command: <T,>(resource: string, body: unknown, options = {} as { method?: "POST" | "PATCH"; revision?: string; key?: string; signal?: AbortSignal }) => request<T>(resource, { method: options.method ?? "POST", signal: options.signal, headers: { "Idempotency-Key": options.key ?? crypto.randomUUID(), ...(options.revision ? { "If-Match": options.revision } : {}) }, body: JSON.stringify(body) }),
    async templatePreview(version, answers = {}, signal) {
      const response = await fetch(apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, workflowPath(locationId, `template-versions/${version.id}/preview`)), { method: "POST", signal, headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json", "If-Match": concurrencyOf(version) }, body: JSON.stringify({ answers }), credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
      if (!response.ok) { if ([401,403].includes(response.status)) onAccessDenied(); throw new ApiError(response.status, "PREVIEW_UNAVAILABLE", "PREVIEW_UNAVAILABLE"); }
      const blob = await response.blob(); if (!blob.type.startsWith("application/pdf") || !blob.size) throw new Error("PREVIEW_UNAVAILABLE"); return blob;
    },
    async file(versionId, purpose = "view", signal) {
      const response = await fetch(apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, workflowPath(locationId, `document-versions/${versionId}/content?purpose=${encodeURIComponent(purpose)}`)), { signal, headers: { Authorization: `Bearer ${await getToken()}` }, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
      if (!response.ok) { if ([401, 403].includes(response.status)) onAccessDenied(); throw new ApiError(response.status, "FILE_UNAVAILABLE", translate("en","common.error.fileUnavailable")); }
      const blob = await response.blob(); if (!["application/pdf", "image/jpeg", "image/png"].some(type => blob.type.startsWith(type))) throw new Error("The document format is not supported for secure viewing."); return blob;
    },
    async upload(patientId, file, input, key, signal) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
      let attempt = uploadAttempts.get(key);
      if (!attempt) { const reservation = await request<{ uploadSessionId: string }>(`patients/${patientId}/uploads`, { method: "POST", signal, headers: { "Idempotency-Key": key }, body: JSON.stringify({ documentTypeId: input.documentTypeId, ...(input.requirementId ? { requirementId: input.requirementId } : {}), ...(input.existingDocumentId ? { existingDocumentId: input.existingDocumentId, baseVersionId: input.baseVersionId } : {}), file: { name: file.name, contentType: file.type, sizeBytes: file.size, sha256: hash } }) });
        if (!reservation.uploadSessionId) throw new Error("The upload reservation was incomplete. Retry your upload."); attempt = { id: reservation.uploadSessionId, uploaded: false, completionKey: await deriveMutationKey(key, "upload-completion") }; uploadAttempts.set(key, attempt); }
      if (!attempt.uploaded) { const response = await fetch(apiRequestUrl(process.env.NEXT_PUBLIC_API_URL, workflowPath(locationId, `upload-sessions/${attempt.id}/content`)), { method: "PUT", signal, headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": file.type }, body: file, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
        if (!response.ok) { if ([401, 403].includes(response.status)) onAccessDenied(); throw new ApiError(response.status, "UPLOAD_FAILED", translate("en","common.error.uploadFailed")); } attempt.uploaded = true; }
      return request(`upload-sessions/${attempt.id}/completion`, { method: "POST", signal, headers: { "Idempotency-Key": attempt.completionKey }, body: JSON.stringify({ sizeBytes: file.size, sha256: hash }) });
    },
  };
}

export function normalizeSnapshot(input: WorkflowSnapshot): WorkflowSnapshot {
  return { ...input, timeZone: input.timeZone ?? input.location?.timeZone ?? "UTC", patients: input.patients ?? [], appointments: input.appointments ?? [], documents: (input.documents ?? []).map(doc => { const versions = [...doc.versions ?? []].sort((a,b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0)); return { ...doc, versions, candidateVersion: doc.candidateVersion ?? versions.find(v => (v.versionNumber ?? 0) > (doc.currentVersion?.versionNumber ?? 0)) ?? null }; }), templates: (input.templates ?? []).map(template => ({ ...template, name: template.name ?? template.title ?? "Untitled template", versions: [...template.versions ?? []].sort((a,b) => (a.versionNumber ?? 0) - (b.versionNumber ?? 0)) })), requests: (input.requests ?? []).map(request => ({ ...request, status: request.status ?? request.state ?? "open" })), workItems: input.workItems ?? [], providers: (input.providers ?? []).map(provider => ({ ...provider, name: provider.name ?? provider.displayName ?? "Provider" })), visitTypes: input.visitTypes ?? [], documentTypes: input.documentTypes ?? [] };
}

/** Multi-stage operations retain stable, distinct UUID keys for each server command. */
export async function deriveMutationKey(base: string, stage: string) { const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${base}:${stage}`))).slice(0,16); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128; const hex = Array.from(bytes, value => value.toString(16).padStart(2,"0")).join(""); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; }
