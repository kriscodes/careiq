import { createInsurancePreviewAdapter } from "./insurance-preview";
import { type WorkflowAdapter, type WorkflowSnapshot, type WorkflowAppointment, type WorkflowDocument, type WorkflowTemplate, type WorkflowRequest, type WorkflowActivity, type DocumentVersion, type Requirement } from "../../lib/api/workflow";

const sampleDay = "2026-10-16";
const caps = { patientsRead: true, patientsCreate: true, patientsUpdate: true, appointmentsRead: true, appointmentsCreate: true, appointmentsUpdate: true, documentsRead: true, documentsUpload: true, documentsReview: true, documentsArchive: true, requestsSend: true, requirementsWaive: true, configurationManage: true, workManage: true, activityRead: true };
const requirement = (id: string, label: string, progressState: string): Requirement => ({ id, labelSnapshot: label, progressState, documentTypeId: label.includes("Consent") ? "consent" : "insurance", lifecycleState: "active", reviewRequired: true, signatureRequired: false, revision: 1 });
export function previewSeed(): WorkflowSnapshot {
  const patients = [
    { id: "p1", firstName: "Alex", lastName: "Morgan", email: "alex@example.test", phone: "(555) 010-0101", dateOfBirth: "1988-04-12", revision: 1 },
    { id: "p2", firstName: "Jordan", lastName: "Lee", email: "jordan@example.test", phone: "(555) 010-0102", dateOfBirth: "1992-08-21", revision: 1 },
    { id: "p3", firstName: "Sam", lastName: "Rivera", email: "sam@example.test", phone: "(555) 010-0103", dateOfBirth: "1979-01-18", revision: 1 },
    { id: "p4", firstName: "Taylor", lastName: "Brooks", email: null, phone: "(555) 010-0104", dateOfBirth: "1985-11-09", revision: 1 },
    { id: "p5", firstName: "Casey", lastName: "Chen", email: "casey@example.test", phone: null, dateOfBirth: "1996-03-03", revision: 1 },
  ];
  const appointments: WorkflowAppointment[] = patients.map((patient, i) => ({ id: `a${i + 1}`, patientId: patient.id, providerId: i % 2 ? "dr2" : "dr1", visitTypeId: i === 0 ? "new" : "followup", scheduledAt: `${sampleDay}T${String(16 + i).padStart(2, "0")}:00:00.000Z`, endsAt: `${sampleDay}T${String(16 + i).padStart(2, "0")}:30:00.000Z`, reason: i === 0 ? "New patient consultation" : "Follow-up visit", status: i === 0 ? "checked_in" : "scheduled", revision: 1, readiness: { status: i === 1 || i === 3 ? "ready" : i === 0 ? "needs_review" : "missing", requiredCount: 2, satisfiedCount: i === 1 || i === 3 ? 2 : 1, missingCount: i > 1 && i !== 3 ? 1 : 0, needsReviewCount: i === 0 ? 1 : 0 }, requirements: [requirement(`r${i}1`, "Insurance card", i === 0 ? "needs_review" : "satisfied"), requirement(`r${i}2`, "Consent to treatment", i === 1 || i === 3 ? "satisfied" : "missing")] }));
  const version = (id: string, decision?: string): DocumentVersion => ({ id, versionNumber: 1, status: "available", originalFilename: "insurance-card.pdf", contentType: "application/pdf", sizeBytes: 36424, createdAt: `${sampleDay}T15:20:00.000Z`, review: decision ? { decision } : null });
  const documents: WorkflowDocument[] = [{ id: "d1", patientId: "p1", documentTypeId: "insurance", title: "Insurance card", revision: 1, currentVersionId: "v1", currentVersion: version("v1"), versions: [version("v1")], archivedAt: null }, { id: "d2", patientId: "p2", documentTypeId: "consent", title: "Consent to treatment", revision: 1, currentVersionId: "v2", currentVersion: version("v2", "accepted"), versions: [version("v2", "accepted")], archivedAt: null }, { id: "d3", patientId: "p3", documentTypeId: "insurance", title: "Previous insurance card", revision: 1, currentVersionId: "v3", currentVersion: version("v3", "replacement_required"), versions: [version("v3", "replacement_required")], archivedAt: null }];
  const templates: WorkflowTemplate[] = [{ id: "t1", name: "Consent to treatment", title: "Consent to treatment", documentTypeId: "consent", publishedVersionId: "tv1", revision: 1, versions: [{ id: "tv1", versionNumber: 1, state: "published", content: "I authorize the care team to provide the treatment discussed with me. I have had an opportunity to ask questions.", fields: [{ key: "full_name", label: "Full name", type: "text", required: true }, { key: "consent", label: "I understand and agree", type: "checkbox", required: true }] }] }, { id: "t2", name: "New patient intake", title: "New patient intake", documentTypeId: "intake", publishedVersionId: null, revision: 1, versions: [{ id: "tv2", versionNumber: 1, state: "draft", content: "Tell us a little about yourself before your first visit.", fields: [{ key: "reason", label: "Reason for your visit", type: "textarea", required: true }] }] }];
  const snapshot: WorkflowSnapshot = { location: { id: "preview", name: "Westside clinic", timeZone: "America/Los_Angeles" }, timeZone: "America/Los_Angeles", patients, appointments, documents, templates, requests: [{ id: "q1", patientId: "p3", appointmentId: "a3", purpose: "collection", status: "open", state: "open", recipientEmail: "sam@example.test", deliveryStatus: "disabled", dueAt: `${sampleDay}T20:00:00.000Z`, revision: 1, items: [{ documentTypeId: "consent", label: "Consent to treatment", status: "missing", requirementId: "r22" }] }], workItems: [{ id: "w1", patientId: "p1", appointmentId: "a1", documentId: "d1", kind: "document_review", title: "Review Alex’s insurance card", state: "open", priority: "normal", revision: 1 }, { id: "w2", patientId: "p3", appointmentId: "a3", kind: "missing_document", title: "Collect Sam’s consent", state: "open", priority: "high", revision: 1 }], providers: [{ id: "dr1", name: "Dr. Avery Patel", displayName: "Dr. Avery Patel" }, { id: "dr2", name: "Dr. Jamie Kim", displayName: "Dr. Jamie Kim" }], visitTypes: [{ id: "new", name: "New patient", defaultDurationMinutes: 45 }, { id: "followup", name: "Follow-up", defaultDurationMinutes: 30 }], documentTypes: [{ id: "insurance", name: "Insurance card" }, { id: "consent", name: "Consent to treatment" }, { id: "intake", name: "Patient intake" }], capabilities: caps, asOf: `${sampleDay}T15:30:00.000Z` };
  hydrateRequirements(snapshot);
  return snapshot;
}

/** Upgrade saved synthetic records without guessing across multiple documents of the same type. */
function hydrateRequirements(snapshot: WorkflowSnapshot) {
  for (const appointment of snapshot.appointments) {
    for (const req of appointment.requirements ?? []) {
      req.patientId ??= appointment.patientId;
      req.appointmentId ??= appointment.id;
      req.lifecycleState ??= req.progressState === "waived" ? "waived" : "active";
      req.reviewRequired ??= true;
      req.signatureRequired ??= false;
      const documents = snapshot.documents.filter(doc => doc.patientId === appointment.patientId && doc.documentTypeId === req.documentTypeId && !doc.archivedAt);
      if (documents.length !== 1) continue;
      const doc = documents[0];
      if (req.selectedEvidence && [doc.currentVersion, doc.candidateVersion, ...(doc.versions ?? [])].some(version => version?.id === req.selectedEvidence?.documentVersionId)) req.selectedEvidence.documentId ??= doc.id;
      const versions = [doc.candidateVersion, doc.currentVersion, ...(doc.versions ?? [])].filter((version): version is DocumentVersion => Boolean(version));
      if (req.candidateVersionId) {
        if (versions.some(version => version.id === req.candidateVersionId)) req.candidateDocumentId ??= doc.id;
      } else {
        const version = doc.candidateVersion ?? doc.currentVersion ?? [...versions].sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0))[0];
        if (version) { req.candidateVersionId = version.id; req.candidateDocumentId = doc.id; }
      }
    }
    recomputeReadiness(appointment);
  }
}
function recomputeReadiness(appointment: WorkflowAppointment) {
  const requirements = (appointment.requirements ?? []).filter(req => req.lifecycleState !== "retired");
  const satisfiedCount = requirements.filter(req => req.progressState === "satisfied").length;
  const waivedCount = requirements.filter(req => req.lifecycleState === "waived").length;
  const needsReviewCount = requirements.filter(req => req.progressState === "needs_review").length;
  appointment.readiness = { status: !requirements.length ? "not_required" : satisfiedCount + waivedCount === requirements.length ? "ready" : "not_ready", requiredCount: requirements.length, satisfiedCount, waivedCount, needsReviewCount, missingCount: requirements.length - satisfiedCount - waivedCount - needsReviewCount };
}
function candidateProgress(req: Requirement, snapshot: WorkflowSnapshot) {
  const selectedDoc = req.selectedEvidence && snapshot.documents.find(doc => doc.patientId === req.patientId && doc.documentTypeId === req.documentTypeId && !doc.archivedAt && [doc.currentVersion, doc.candidateVersion, ...(doc.versions ?? [])].some(version => version?.id === req.selectedEvidence?.documentVersionId));
  const selectedVersion = selectedDoc && [selectedDoc.currentVersion, selectedDoc.candidateVersion, ...(selectedDoc.versions ?? [])].find(version => version?.id === req.selectedEvidence?.documentVersionId);
  if (selectedVersion?.status === "available" && (!req.reviewRequired || selectedVersion.review?.decision === "accepted" && selectedVersion.review.id === req.selectedEvidence?.acceptedReviewId) && !req.signatureRequired) return "satisfied";
  const doc = snapshot.documents.find(doc => doc.id === req.candidateDocumentId && !doc.archivedAt);
  const version = [doc?.candidateVersion, doc?.currentVersion, ...(doc?.versions ?? [])].find(version => version?.id === req.candidateVersionId);
  if (!version) return "missing";
  if (version.status !== "available") return "processing";
  if (version.review?.decision === "replacement_required") return "replacement_requested";
  return req.signatureRequired ? "requested" : "needs_review";
}

/** This adapter never contacts the API. Only clearly marked synthetic preview data is persisted. */
export function createPreviewAdapter(): WorkflowAdapter {
  let state = previewSeed();
  let restored = false;
  const activity: WorkflowActivity[] = [{ id: "sample-event", action: "document.uploaded", summary: "Synthetic insurance card added for staff review", actorLabel: "Demo staff", createdAt: state.asOf }];
  function restore() { if (restored) return; restored = true; try { const saved = JSON.parse(localStorage.getItem("careiq-synthetic-workflow-v1") ?? "null"); if (saved?.synthetic === true && saved.snapshot?.patients && saved.snapshot?.capabilities) state = saved.snapshot; } catch { /* Start with deterministic sample data. */ } hydrateRequirements(state); }
  function persist() { try { localStorage.setItem("careiq-synthetic-workflow-v1", JSON.stringify({ synthetic: true, snapshot: state })); } catch { /* Private browser modes may disable storage. */ } }
  const copy = <T,>(value: T): T => structuredClone(value);
  const find = (group: string, id: string) => { const source = ({ patients: state.patients, appointments: state.appointments, documents: state.documents, templates: state.templates, "template-versions": state.templates.flatMap(template => template.versions ?? []), requests: state.requests, "work-items": state.workItems, requirements: state.appointments.flatMap(a => a.requirements ?? []) } as Record<string, Array<{ id: string }>>)[group]; const record = source?.find(r => r.id === id); if (!record) throw new Error("This sample record is unavailable."); return record as unknown as Record<string, unknown>; };
  return {
    preview: true,
    insurance: createInsurancePreviewAdapter(() => state),
    async load() { restore(); return copy(state); },
    async page<T>() { return { data: [] as T[], pagination: { hasMore: false, nextCursor: null } }; },
    async detail<T>(resource: string) { restore(); if (resource.startsWith("activity")) return copy(activity) as T; const [group, id, extra] = resource.split("/"); if (group === "availability") return { slots: ["09:00", "10:30", "13:00", "14:30"].map(time => ({ startsAt: `${sampleDay}T${time}:00-07:00` })) } as T; const record = find(group, id); return copy(extra === "versions" ? record.versions : record) as T; },
    async command<T>(resource: string, body: unknown, options?: { method?: "POST" | "PATCH"; revision?: string; key?: string; signal?: AbortSignal }) {
      restore(); const input = body as Record<string, unknown>; const [group, id, action] = resource.split("/"); let result: unknown;
      if (!id && ["providers", "visit-types", "document-types"].includes(group)) { const entry = { id: crypto.randomUUID(), name: String(input.name ?? input.displayName), displayName: input.displayName ? String(input.displayName) : undefined, defaultDurationMinutes: input.defaultDurationMinutes ? Number(input.defaultDurationMinutes) : undefined, revision: 1 }; if (group === "providers") state.providers.push(entry); if (group === "visit-types") state.visitTypes.push(entry); if (group === "document-types") state.documentTypes.push(entry); result = entry; }
      else if (group === "requirement-rule-sets") { result = { id: crypto.randomUUID(), state: "published" }; }
      else if (group === "providers" && action === "availability") { result = { id, state: "active" }; }
      else if (!id && group === "patients") { const patient = { id: crypto.randomUUID(), firstName: String(input.firstName), lastName: String(input.lastName), email: input.email ? String(input.email) : null, phone: input.phone ? String(input.phone) : null, revision: 1 }; state.patients.push(patient); result = patient; }
      else if (!id && group === "appointments") { const appointment = { ...input, id: crypto.randomUUID(), revision: 1, status: "scheduled", requirements: [], readiness: { status: "not_required", requiredCount: 0 } } as unknown as WorkflowAppointment; state.appointments.push(appointment); result = appointment; }
      else if (!id && group === "templates") { const template: WorkflowTemplate = { id: crypto.randomUUID(), name: String(input.title ?? input.name), title: String(input.title ?? input.name), documentTypeId: String(input.documentTypeId), revision: 1, publishedVersionId: null, versions: [{ id: crypto.randomUUID(), state: "draft", versionNumber: 1, content: String(input.content ?? ""), fieldSchema: input.fieldSchema as WorkflowTemplate["fields"], schemaVersion: input.schemaVersion as number | undefined, formSchema: input.formSchema as import("@/lib/api/workflow").FormSchema | undefined, revision: 1, fields: input.fields as WorkflowTemplate["fields"] }] }; state.templates.push(template); result = template; }
      else if (!id && group === "requests") { const request = { ...input, id: crypto.randomUUID(), status: "open", state: "open", deliveryStatus: "disabled", deliveryState: "disabled", revision: 1 } as WorkflowRequest; state.requests.push(request); result = request; }
      else if (group === "document-versions") {
        const doc = state.documents.find(d => d.versions?.some(v => v.id === id));
        if (!doc) throw new Error("Sample document unavailable.");
        const ver = doc.versions!.find(v => v.id === id)!;
        if (action === "access-grants") throw new Error("Synthetic preview documents contain no real file. Upload a sample file to review the workflow.");
        if (doc.archivedAt || doc.currentVersionId !== id || ver.status !== "available") throw new Error("Choose the current available document version before reviewing it.");
        const selectedIds = new Set(Array.isArray(input.requirementIds) ? input.requirementIds.map(String) : []);
        const matching = state.appointments.filter(a => a.patientId === doc.patientId).flatMap(a => a.requirements ?? []).filter(req => req.documentTypeId === doc.documentTypeId && req.lifecycleState === "active");
        if ([...selectedIds].some(requirementId => !matching.some(req => req.id === requirementId))) throw new Error("Choose an active requirement for this patient and document type.");
        ver.review = { id: crypto.randomUUID(), decision: String(input.decision) };
        if (doc.currentVersion?.id === id) doc.currentVersion.review = ver.review;
        doc.revision = (doc.revision ?? 1) + 1;
        for (const req of matching) {
          const selected = selectedIds.has(req.id);
          if (input.decision === "accepted" && selected) {
            req.selectedEvidence = { id: crypto.randomUUID(), documentId: doc.id, documentVersionId: id, acceptedReviewId: ver.review.id };
            req.candidateDocumentId = doc.id; req.candidateVersionId = id;
            req.progressState = req.signatureRequired ? "requested" : "satisfied";
            req.revision = (req.revision ?? 1) + 1;
          } else if (input.decision === "replacement_required" && (selected || req.selectedEvidence?.documentVersionId === id)) {
            req.selectedEvidence = null; req.progressState = "replacement_requested"; req.revision = (req.revision ?? 1) + 1;
          }
        }
        state.appointments.filter(a => a.patientId === doc.patientId).forEach(recomputeReadiness);
        result = doc;
      }
      else {
        const record = find(group, id);
        if (group === "template-versions" && action === "validation") return { valid: true, issues: [], templateVersionId: id, draftRevision: record.revision ?? 1 } as T;
        const revision = Number(record.revision ?? 1);
        if (options?.revision && options.revision !== `"${revision}"`) throw new Error("This sample changed. Refresh before saving again.");
        if (options?.method === "PATCH") { if (group === "template-versions" && record.state === "published") throw new Error("Published template versions are immutable."); Object.assign(record, input); }
        if (group === "appointments" && action === "status") record.status = input.status ?? input.targetStatus;
        if (group === "appointments" && action === "cancellation") record.status = "cancelled";
        if (group === "documents" && action === "current-version") { record.currentVersionId = input.documentVersionId; record.currentVersion = (record.versions as DocumentVersion[]).find(v => v.id === input.documentVersionId); }
        if (group === "documents" && action === "archive") record.archivedAt = new Date().toISOString();
        if (group === "documents" && action === "restore") record.archivedAt = null;
        if (group === "templates" && action === "versions") { const versions = record.versions as Array<Record<string, unknown>>; const version = { ...input, id: crypto.randomUUID(), versionNumber: versions.length + 1, state: "draft", revision: 1 }; versions.push(version); result = version; }
        if (group === "templates" && action === "publication") { const versions = record.versions as Array<Record<string, unknown>>; const version = versions.find(v => v.id === input.versionId) ?? versions.at(-1)!; version.state = "published"; record.publishedVersionId = version.id; }
        if (group === "templates" && action === "preparations") { const doc: WorkflowDocument = { id: crypto.randomUUID(), patientId: String(input.patientId), documentTypeId: String(record.documentTypeId), title: String(record.title ?? record.name), revision: 1, currentVersion: { id: crypto.randomUUID(), versionNumber: 1, status: "processing" }, versions: [] }; state.documents.push(doc); result = { state: "queued", documentId: doc.id }; }
        if (group === "work-items" && action === "assignment") record.assigneeUserId = input.assigneeUserId;
        if (group === "requests" && action === "cancellation") { record.state = "cancelled"; record.status = "cancelled"; }
        if (group === "requests" && ["reminders", "reissue"].includes(action)) { record.deliveryStatus = "disabled"; record.deliveryState = "disabled"; }
        if (group === "requirements" && action === "evidence") {
          const req = record as Requirement;
          if (req.lifecycleState !== "active") throw new Error("Restore this requirement before selecting evidence.");
          const doc = state.documents.find(doc => doc.patientId === req.patientId && doc.documentTypeId === req.documentTypeId && !doc.archivedAt && [doc.currentVersion, doc.candidateVersion, ...(doc.versions ?? [])].some(version => version?.id === input.documentVersionId));
          const version = [doc?.currentVersion, doc?.candidateVersion, ...(doc?.versions ?? [])].find(version => version?.id === input.documentVersionId);
          if (!doc || !version || version.status !== "available") throw new Error("Choose an available document version for this patient and document type.");
          if (req.reviewRequired && version.review?.decision !== "accepted") throw new Error("Review and accept this document version before using it as evidence.");
          if (req.signatureRequired) throw new Error("A completed signature must be verified in the local application before using this document.");
          req.selectedEvidence = { id: crypto.randomUUID(), documentId: doc.id, documentVersionId: version.id, acceptedReviewId: version.review?.id ?? null };
          req.candidateDocumentId ??= doc.id; req.candidateVersionId ??= version.id;
          req.progressState = "satisfied";
        }
        if (group === "requirements" && action === "waiver") { record.lifecycleState = "waived"; record.progressState = "waived"; }
        if (group === "requirements" && action === "waiver-revocation") { record.lifecycleState = "active"; record.progressState = candidateProgress(record as Requirement, state); }
        if (group === "requirements") state.appointments.filter(a => a.requirements?.some(req => req.id === id)).forEach(recomputeReadiness);
        record.revision = revision + 1; result ??= record;
      }
      state.asOf = new Date().toISOString(); activity.unshift({ id: crypto.randomUUID(), action: resource.replaceAll("/", "."), summary: "Synthetic preview change", actorLabel: "Demo staff", createdAt: state.asOf }); persist(); return copy(result) as T;
    },
    async file() { throw new Error("This synthetic preview has no real document files. Use the local application to view securely stored documents."); },
    async upload(patientId, file, input) {
      restore();
      const documentTypeId = String(input.documentTypeId ?? "");
      const req = input.requirementId ? state.appointments.flatMap(appointment => appointment.requirements ?? []).find(req => req.id === input.requirementId) : undefined;
      if (input.requirementId && (!req || req.patientId !== patientId || req.documentTypeId !== documentTypeId || req.lifecycleState !== "active")) throw new Error("Choose an active requirement for this patient and document type.");
      let doc = input.existingDocumentId ? state.documents.find(doc => doc.id === input.existingDocumentId) : undefined;
      if (input.existingDocumentId && (!doc || doc.patientId !== patientId || doc.documentTypeId !== documentTypeId || doc.archivedAt)) throw new Error("Choose an active document for this patient and document type.");
      if (doc && (input.baseVersionId ?? null) !== (doc.currentVersionId ?? null)) throw new Error("This document changed. Refresh it before uploading another version.");
      const versions = doc ? [...(doc.versions ?? []), ...(doc.currentVersion ? [doc.currentVersion] : []), ...(doc.candidateVersion ? [doc.candidateVersion] : [])] : [];
      const ver: DocumentVersion = { id: crypto.randomUUID(), versionNumber: Math.max(0, ...versions.map(version => version.versionNumber ?? 0)) + 1, originalFilename: file.name, contentType: file.type, sizeBytes: file.size, status: "processing", createdAt: new Date().toISOString(), review: null };
      if (doc) { doc.versions = [...new Map([...versions, ver].map(version => [version.id, version])).values()]; doc.revision = (doc.revision ?? 1) + 1; }
      else { doc = { id: crypto.randomUUID(), patientId, documentTypeId, title: file.name, revision: 1, currentVersion: null, currentVersionId: null, versions: [ver] }; state.documents.push(doc); }
      doc.candidateVersion = ver; doc.candidateVersionId = ver.id;
      if (req) {
        req.candidateDocumentId = doc.id; req.candidateVersionId = ver.id;
        if (req.progressState !== "satisfied" || !req.selectedEvidence) req.progressState = "processing";
        req.revision = (req.revision ?? 1) + 1;
        state.appointments.filter(appointment => appointment.id === req.appointmentId).forEach(recomputeReadiness);
      }
      state.asOf = new Date().toISOString(); persist();
      return { state: "processing", documentId: doc.id, documentVersionId: ver.id };
    },
  };
}
