import assert from "node:assert/strict";
import test from "node:test";
import { allowed, createWorkflowAdapter, workflowPath, type WorkflowSnapshot } from "../src/lib/api/workflow";
import { createPreviewAdapter, previewSeed } from "../src/components/workflow/preview-adapter";
process.env.NEXT_PUBLIC_API_URL = "https://careiq.invalid";
const location = "0192e0b8-2b33-7000-8000-000000000001";
test("workflow paths retain the explicit location and reject path escapes", () => { assert.equal(workflowPath(location, "?date=2026-10-16"), `/api/v1/locations/${location}/workflow?date=2026-10-16`); assert.throws(() => workflowPath("other", "patients")); assert.throws(() => workflowPath(location, "../patients")); });
test("actions require explicit server grants and honor per-record action restrictions", () => { assert.equal(allowed(undefined, "document.review", { documentsRead: true }), false); assert.equal(allowed(undefined, "document.review", { documentsReview: true }), true); assert.equal(allowed({ id: "doc", allowedActions: [] }, "document.review", { documentsReview: true }), false); assert.equal(allowed({ id: "req", allowedActions: ["waive"] }, "requirement.waive"), true); });
test("document uploads hash the file, reserve metadata, upload raw bytes, and finalize the same session", async () => { const original = globalThis.fetch; const calls: Array<{ url: string; method?: string; headers: Headers; body: unknown }> = []; globalThis.fetch = async (input, init) => { const url = String(input); calls.push({ url, method: init?.method, headers: new Headers(init?.headers), body: init?.body }); return Response.json({ data: url.endsWith("/uploads") ? { uploadSessionId: "session-test", state: "reserved" } : { state: "queued" } }); }; try { const adapter = createWorkflowAdapter(location, async () => "synthetic-token", () => assert.fail("Access should remain authorized")); const file = new File(["%PDF-1.4 synthetic"], "synthetic.pdf", { type: "application/pdf" }); await adapter.upload("patient-test", file, { documentTypeId: "type-test" }, "synthetic-key"); assert.equal(calls.length, 3); const reservation = JSON.parse(calls[0].body as string); assert.deepEqual(Object.keys(reservation).sort(), ["documentTypeId", "file"]); assert.equal(reservation.file.contentType, "application/pdf"); assert.match(reservation.file.sha256, /^[a-f0-9]{64}$/); assert.equal(calls[1].method, "PUT"); assert.equal(calls[1].headers.get("Content-Type"), "application/pdf"); assert.equal(calls[1].body, file); assert.ok(calls[1].url.endsWith("/upload-sessions/session-test/content")); assert.ok(calls[2].url.endsWith("/upload-sessions/session-test/completion")); assert.notEqual(calls[2].headers.get("Idempotency-Key"), "synthetic-key"); assert.match(calls[2].headers.get("Idempotency-Key")!, /^[a-f0-9-]{36}$/); } finally { globalThis.fetch = original; } });
test("a lost upload completion response retries only completion with its original stage key", async () => { const original = globalThis.fetch; const calls: Array<{ url: string; key: string | null }> = []; let failed = false; globalThis.fetch = async (input, init) => { const url = String(input); calls.push({ url, key: new Headers(init?.headers).get("Idempotency-Key") }); if (url.endsWith("/completion") && !failed) { failed = true; throw new Error("Synthetic connection dropped after save"); } return Response.json({ data: url.endsWith("/uploads") ? { uploadSessionId: "session-retry", state: "reserved" } : { state: "available" } }); }; try { const adapter = createWorkflowAdapter(location, async () => "synthetic-token", () => {}); const file = new File(["%PDF-1.4 synthetic"], "synthetic.pdf", { type: "application/pdf" }); await assert.rejects(adapter.upload("patient-test", file, { documentTypeId: "type-test" }, "retry-base-key")); await adapter.upload("patient-test", file, { documentTypeId: "type-test" }, "retry-base-key"); assert.equal(calls.length, 4); assert.ok(calls[2].url.endsWith("/completion")); assert.equal(calls[2].url, calls[3].url); assert.equal(calls[2].key, calls[3].key); assert.notEqual(calls[2].key, calls[0].key); } finally { globalThis.fetch = original; } });


test("requirement-specific uploads preserve the exact requirement and replacement base", async () => {
  const original = globalThis.fetch;
  const reservations: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/uploads")) reservations.push(JSON.parse(String(init?.body)));
    return Response.json({ data: url.endsWith("/uploads") ? { uploadSessionId: "bound-session" } : { state: "available" } });
  };
  try {
    const adapter = createWorkflowAdapter(location, async () => "synthetic-token", () => assert.fail("Access should remain authorized"));
    await adapter.upload("patient-test", new File(["%PDF-1.4 synthetic"], "synthetic.pdf", { type: "application/pdf" }), { documentTypeId: "insurance-type", requirementId: "clicked-requirement", existingDocumentId: "exact-document", baseVersionId: "exact-base-version", ignored: "not transmitted" }, "bound-upload-key");
    assert.equal(reservations[0].requirementId, "clicked-requirement");
    assert.equal(reservations[0].documentTypeId, "insurance-type");
    assert.equal(reservations[0].existingDocumentId, "exact-document");
    assert.equal(reservations[0].baseVersionId, "exact-base-version");
    assert.equal(reservations[0].ignored, undefined);
  } finally { globalThis.fetch = original; }
});

async function withPreviewStorage(snapshot: WorkflowSnapshot, run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = new Map([["careiq-synthetic-workflow-v1", JSON.stringify({ synthetic: true, snapshot })]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  try { await run(); }
  finally { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); }
}

test("restored preview requirements gain exact context only for a unique patient/type document", async () => {
  const seed = previewSeed();
  const requirement = seed.appointments[0].requirements![0];
  delete requirement.candidateDocumentId; delete requirement.candidateVersionId; delete requirement.lifecycleState; delete requirement.patientId; delete requirement.appointmentId;
  await withPreviewStorage(seed, async () => {
    const restored = await createPreviewAdapter().load("2026-10-16");
    const req = restored.appointments[0].requirements![0];
    assert.equal(req.candidateDocumentId, "d1"); assert.equal(req.candidateVersionId, "v1");
    assert.equal(req.patientId, "p1"); assert.equal(req.appointmentId, "a1"); assert.equal(req.lifecycleState, "active");
    assert.equal(req.reviewRequired, true); assert.equal(req.signatureRequired, false);
  });
  seed.documents.push({ ...structuredClone(seed.documents[0]), id: "another-insurance-card", currentVersionId: "another-version", currentVersion: { id: "another-version", status: "available" }, versions: [{ id: "another-version", status: "available" }] });
  await withPreviewStorage(seed, async () => {
    const req = (await createPreviewAdapter().load("2026-10-16")).appointments[0].requirements![0];
    assert.equal(req.candidateDocumentId, undefined); assert.equal(req.candidateVersionId, undefined);
  });
});

test("preview review binds only selected requirements and waiver changes recompute readiness", async () => {
  const seed = previewSeed();
  seed.appointments.push({ ...structuredClone(seed.appointments[0]), id: "other-visit", requirements: [{ ...structuredClone(seed.appointments[0].requirements![0]), id: "other-requirement", appointmentId: "other-visit" }] });
  await withPreviewStorage(seed, async () => {
    const adapter = createPreviewAdapter();
    await adapter.command("document-versions/v1/reviews", { decision: "accepted", requirementIds: ["r01"], expectedDocumentRevision: 1 });
    let snapshot = await adapter.load("2026-10-16");
    const reviewed = snapshot.appointments[0].requirements![0];
    let other = snapshot.appointments.find(appointment => appointment.id === "other-visit")!;
    assert.equal(reviewed.progressState, "satisfied"); assert.equal(reviewed.selectedEvidence?.documentVersionId, "v1");
    assert.equal(other.requirements![0].progressState, "needs_review"); assert.equal(other.requirements![0].selectedEvidence, undefined);
    assert.equal(snapshot.appointments[0].readiness?.satisfiedCount, 1); assert.equal(snapshot.appointments[0].readiness?.missingCount, 1);
    await adapter.command("requirements/other-requirement/waiver", { reasonCode: "staff_exception" }, { revision: '"1"' });
    snapshot = await adapter.load("2026-10-16"); other = snapshot.appointments.find(appointment => appointment.id === "other-visit")!;
    assert.equal(other.requirements![0].lifecycleState, "waived"); assert.equal(other.readiness?.waivedCount, 1); assert.equal(other.readiness?.status, "ready");
    await adapter.command("requirements/other-requirement/waiver-revocation", { reasonCode: "exception_ended" }, { revision: '"2"' });
    snapshot = await adapter.load("2026-10-16"); other = snapshot.appointments.find(appointment => appointment.id === "other-visit")!;
    assert.equal(other.requirements![0].lifecycleState, "active"); assert.equal(other.requirements![0].progressState, "needs_review");
    assert.equal(other.readiness?.waivedCount, 0); assert.equal(other.readiness?.needsReviewCount, 1); assert.equal(other.readiness?.status, "not_ready");
  });
});


test("preview evidence validates the exact version and links only the clicked requirement", async () => {
  await withPreviewStorage(previewSeed(), async () => {
    const adapter = createPreviewAdapter();
    await assert.rejects(adapter.command("requirements/r01/evidence", { documentVersionId: "v2" }, { revision: '"1"' }), /this patient and document type/);
    await assert.rejects(adapter.command("requirements/r01/evidence", { documentVersionId: "v1" }, { revision: '"1"' }), /Review and accept/);
    await adapter.command("document-versions/v1/reviews", { decision: "accepted", requirementIds: [], expectedDocumentRevision: 1 });
    assert.equal((await adapter.load("2026-10-16")).appointments[0].requirements![0].progressState, "needs_review");
    await adapter.command("requirements/r01/evidence", { documentVersionId: "v1" }, { revision: '"1"' });
    const snapshot = await adapter.load("2026-10-16");
    const appointment = snapshot.appointments[0]; const req = appointment.requirements![0];
    assert.equal(req.progressState, "satisfied"); assert.equal(req.revision, 2);
    assert.equal(req.selectedEvidence?.documentId, "d1"); assert.equal(req.selectedEvidence?.documentVersionId, "v1");
    assert.equal(req.selectedEvidence?.acceptedReviewId, snapshot.documents[0].currentVersion?.review?.id);
    assert.equal(appointment.requirements![1].progressState, "missing");
    assert.equal(appointment.readiness?.satisfiedCount, 1); assert.equal(appointment.readiness?.missingCount, 1);
  });
});

test("preview replacement uploads append processing versions and preserve the reviewed current file", async () => {
  const seed = previewSeed();
  seed.documents[0].currentVersion!.review = { id: "previous-review", decision: "accepted" };
  seed.documents[0].versions![0].review = { id: "previous-review", decision: "accepted" };
  await withPreviewStorage(seed, async () => {
    const adapter = createPreviewAdapter();
    const file = new File(["%PDF-1.4 replacement"], "replacement.pdf", { type: "application/pdf" });
    const result = await adapter.upload("p1", file, { documentTypeId: "insurance", requirementId: "r01", existingDocumentId: "d1", baseVersionId: "v1" }, "preview-replacement") as { state: string; documentId: string; documentVersionId: string };
    let snapshot = await adapter.load("2026-10-16");
    const doc = snapshot.documents.find(document => document.id === "d1")!;
    assert.equal(snapshot.documents.length, seed.documents.length); assert.equal(result.documentId, "d1"); assert.equal(result.state, "processing");
    assert.equal(doc.versions?.length, 2); assert.equal(doc.candidateVersion?.versionNumber, 2);
    assert.equal(doc.currentVersionId, "v1"); assert.equal(doc.currentVersion?.review?.decision, "accepted"); assert.equal(doc.currentVersion?.review?.id, "previous-review");
    assert.equal(doc.candidateVersion?.id, result.documentVersionId); assert.equal(doc.candidateVersion?.status, "processing"); assert.equal(doc.candidateVersion?.review, null);
    const req = snapshot.appointments[0].requirements![0];
    assert.equal(req.candidateDocumentId, "d1"); assert.equal(req.candidateVersionId, result.documentVersionId); assert.equal(req.progressState, "processing"); assert.equal(req.selectedEvidence, undefined);
    await assert.rejects(adapter.command(`document-versions/${result.documentVersionId}/reviews`, { decision: "accepted", requirementIds: ["r01"] }), /current available document version/);
    await assert.rejects(adapter.command("requirements/r01/evidence", { documentVersionId: result.documentVersionId }, { revision: '"2"' }), /available document version/);
    await assert.rejects(adapter.upload("p1", file, { documentTypeId: "insurance", requirementId: "r01", existingDocumentId: "d1", baseVersionId: "stale-version" }, "stale-preview-replacement"), /document changed/);
    await assert.rejects(adapter.upload("p1", file, { documentTypeId: "insurance", requirementId: "r22", existingDocumentId: "d1", baseVersionId: "v1" }, "wrong-preview-requirement"), /active requirement/);
    await adapter.command("requirements/r01/evidence", { documentVersionId: "v1" }, { revision: '"2"' });
    await adapter.command("requirements/r01/waiver", { reasonCode: "temporary_exception" }, { revision: '"3"' });
    await adapter.command("requirements/r01/waiver-revocation", { reasonCode: "exception_ended" }, { revision: '"4"' });
    const restored = (await adapter.load("2026-10-16")).appointments[0].requirements![0];
    assert.equal(restored.progressState, "satisfied"); assert.equal(restored.selectedEvidence?.documentVersionId, "v1"); assert.equal(restored.candidateVersionId, result.documentVersionId);
    const added = await adapter.upload("p1", file, { documentTypeId: "consent", requirementId: "r02" }, "preview-new-upload") as { documentId: string };
    snapshot = await adapter.load("2026-10-16");
    const newDoc = snapshot.documents.find(document => document.id === added.documentId)!;
    assert.equal(snapshot.documents.length, seed.documents.length + 1); assert.equal(newDoc.currentVersionId, null); assert.equal(newDoc.currentVersion, null); assert.equal(newDoc.candidateVersion?.status, "processing");
    assert.equal(snapshot.appointments[0].requirements![1].candidateDocumentId, added.documentId); assert.equal(snapshot.appointments[0].requirements![1].progressState, "processing");
  });
});
