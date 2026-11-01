import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkflowSchedule, loadWorkflowAvailability, createWorkflowAdapter, patientName, type WorkflowAdapter, type WorkflowSnapshot, type WorkflowAppointment } from "../src/lib/api/workflow";
import { createPreviewAdapter, previewSeed } from "../src/components/workflow/preview-adapter";

const dates = ["2026-10-16", "2026-10-17"];
const appointment = (id: string, scheduledAt: string): WorkflowAppointment => ({ id, patientId: `patient-${id}`, providerId: "dr1", scheduledAt, status: "scheduled", reason: null, patient: { id: `patient-${id}`, displayName: `Patient ${id}` } });
function snapshot(appointments: WorkflowAppointment[] = []): WorkflowSnapshot {
  return { ...previewSeed(), appointments, pagination: {}, asOf: "2026-10-31T00:00:00Z" };
}

test("a week drains every appointment page, preserves cursor binding and uses practice-local dates", async () => {
  const calls: string[] = [];
  const adapter = {
    async load(date: string) { const data = snapshot([appointment(date, `${date}T16:00:00Z`)]); if (date === dates[0]) data.pagination = { appointments: { hasMore: true, nextCursor: "opaque cursor/+", limit: 50 } }; return data; },
    async page(resource: string) { calls.push(resource); if (new URLSearchParams(resource.split("?")[1]).get("date") === "2026-10-15") return { data: [{ ...appointment("overnight", "2026-10-16T06:30:00Z"), endsAt: "2026-10-16T07:30:00Z" }], pagination: { hasMore: false, nextCursor: null } }; return { data: [appointment("late-page", "2026-10-17T06:45:00Z"), appointment("outside", "2026-10-18T16:00:00Z")], pagination: { hasMore: false, nextCursor: null } }; },
  } as unknown as WorkflowAdapter;
  const result = await loadWorkflowSchedule(adapter, dates);
  assert.deepEqual(result.appointments.map(item => item.id).sort(), [...dates, "late-page", "overnight"].sort());
  const query = new URLSearchParams(calls[0].split("?")[1]);
  assert.equal(query.get("date"), dates[0]); assert.equal(query.get("limit"), "50"); assert.equal(query.get("cursor"), "opaque cursor/+");
  assert.equal(result.pagination?.appointments?.hasMore, false);
  assert.equal(patientName(result.appointments.find(item => item.id === "late-page")?.patient), "Patient late-page");
});

test("schedule loading fails closed on lost access, incomplete pagination, changed scope and cancellation", async () => {
  const adapter = { load: async () => snapshot(), page: async () => ({ data: [], pagination: { hasMore: true, nextCursor: "repeated" } }) } as unknown as WorkflowAdapter;
  await assert.rejects(loadWorkflowSchedule(adapter, Array.from({ length: 8 }, (_, i) => `2026-10-${10 + i}`)), /up to seven/);
  adapter.load = async () => ({ ...snapshot(), capabilities: {} });
  await assert.rejects(loadWorkflowSchedule(adapter, dates), error => (error as { status: number }).status === 403);
  adapter.load = async () => ({ ...snapshot(), capabilities: { appointmentsRead: false } });
  await assert.rejects(loadWorkflowSchedule(adapter, dates), error => (error as { status: number }).status === 403);
  adapter.load = async date => ({ ...snapshot(), timeZone: date === dates[0] ? "UTC" : "America/Los_Angeles" });
  await assert.rejects(loadWorkflowSchedule(adapter, dates), /location changed/);
  adapter.load = async () => ({ ...snapshot(), pagination: { appointments: { hasMore: true, nextCursor: null } } });
  await assert.rejects(loadWorkflowSchedule(adapter, [dates[0]]), /complete schedule/);
  adapter.load = async () => ({ ...snapshot(), pagination: { appointments: { hasMore: true, nextCursor: "repeated" } } });
  await assert.rejects(loadWorkflowSchedule(adapter, [dates[0]]), /complete schedule/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadWorkflowSchedule(adapter, dates, controller.signal), error => (error as Error).name === "AbortError");
});

test("availability requests preserve location, provider, duration, exclusion and cancellation", async () => {
  const previous = globalThis.fetch; const previousUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "https://careiq.invalid";
  const signal = new AbortController().signal;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.match(url.pathname, /locations\/0192e0b8-2b33-7000-8000-000000000001\/workflow\/availability$/);
    assert.equal(url.searchParams.get("providerId"), "dr1"); assert.equal(url.searchParams.get("date"), dates[0]);
    assert.equal(url.searchParams.get("durationMinutes"), "45"); assert.equal(url.searchParams.get("excludeAppointmentId"), "a1"); assert.ok(init?.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
    return Response.json({ data: { slots: [] } });
  };
  try { const adapter = createWorkflowAdapter("0192e0b8-2b33-7000-8000-000000000001", async () => "synthetic", () => {}); assert.deepEqual((await loadWorkflowAvailability(adapter, { providerId: "dr1", date: dates[0], durationMinutes: 45, excludeAppointmentId: "a1" }, signal)).slots, []); }
  finally { globalThis.fetch = previous; if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL; else process.env.NEXT_PUBLIC_API_URL = previousUrl; }
});

test("synthetic availability parses queries, uses the requested date and excludes occupied slots", async () => {
  const adapter = createPreviewAdapter();
  const result = await loadWorkflowAvailability(adapter, { providerId: "dr1", date: dates[0], durationMinutes: 30 });
  assert.equal(result.date, dates[0]); assert.equal(result.slots.some(slot => slot.startsAt === "2026-10-16T16:00:00.000Z"), false);
  const editing = await loadWorkflowAvailability(adapter, { providerId: "dr1", date: dates[0], durationMinutes: 30, excludeAppointmentId: "a1" });
  assert.equal(editing.slots.some(slot => slot.startsAt === "2026-10-16T16:00:00.000Z"), true);
  const winter = await loadWorkflowAvailability(adapter, { providerId: "dr1", date: "2026-11-02", durationMinutes: 30 });
  assert.equal(winter.slots[0].startsAt, "2026-11-02T17:00:00.000Z");
});


test("later-day document, request and history dependencies survive the weekly merge", async () => {
  const monday = snapshot(); const tuesday = snapshot();
  monday.documents = [{ id: "monday-doc", patientId: "p1", revision: 2 }];
  tuesday.documents = [{ id: "tuesday-doc", patientId: "p2", revision: 3 }, { id: "monday-doc", patientId: "p1", revision: 1 }];
  tuesday.requests = [{ id: "tuesday-request", patientId: "p2", status: "open" }];
  tuesday.workItems = [{ id: "tuesday-work", kind: "document_review", patientId: "p2" }];
  tuesday.templates = [{ id: "tuesday-template", name: "Tuesday consent" }];
  tuesday.documentTypes = [{ id: "tuesday-type", name: "Tuesday consent" }];
  monday.relatedPagination = { documentVersions: { "monday-doc": { hasMore: true, nextCursor: "monday-history" } } };
  tuesday.relatedPagination = { documentVersions: { "tuesday-doc": { hasMore: true, nextCursor: "tuesday-history" } }, templateVersions: { "tuesday-template": { hasMore: true, nextCursor: "tuesday-template-history" } } };
  const adapter = { load: async (date: string) => date === dates[0] ? monday : tuesday, page: async () => ({ data: [], pagination: { hasMore: false, nextCursor: null } }) } as unknown as WorkflowAdapter;
  const result = await loadWorkflowSchedule(adapter, dates);
  assert.equal(result.documents.find(doc => doc.id === "tuesday-doc")?.revision, 3);
  assert.equal(result.documents.find(doc => doc.id === "monday-doc")?.revision, 2);
  assert.ok(result.requests.some(request => request.id === "tuesday-request")); assert.ok(result.workItems.some(item => item.id === "tuesday-work"));
  assert.ok(result.templates.some(template => template.id === "tuesday-template")); assert.ok(result.documentTypes.some(type => type.id === "tuesday-type"));
  assert.equal(result.relatedPagination?.documentVersions?.["monday-doc"].nextCursor, "monday-history");
  assert.equal(result.relatedPagination?.documentVersions?.["tuesday-doc"].nextCursor, "tuesday-history");
  assert.equal(result.relatedPagination?.templateVersions?.["tuesday-template"].nextCursor, "tuesday-template-history");
});


test("weekly actions retain only capabilities present on every authorized date", async () => {
  const monday = snapshot(); const tuesday = snapshot();
  monday.capabilities = { appointmentsRead: true, appointmentsCreate: true, appointmentsUpdate: true, documentsRead: true };
  tuesday.capabilities = { appointmentsRead: true, appointmentsCreate: false, appointmentsUpdate: false };
  const adapter = { load: async (date: string) => date === dates[0] ? monday : tuesday, page: async () => ({ data: [], pagination: { hasMore: false, nextCursor: null } }) } as unknown as WorkflowAdapter;
  const result = await loadWorkflowSchedule(adapter, dates);
  assert.deepEqual(result.capabilities, { appointmentsRead: true, appointmentsCreate: false, appointmentsUpdate: false, documentsRead: false });
});
