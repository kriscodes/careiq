import assert from "node:assert/strict";
import test from "node:test";
import { createInsuranceAdapter, type ManagerActivityPage } from "../src/lib/api/insurance";
import { previewManagerActivity } from "../src/components/workflow/manager-activity-preview";
import { previewSeed } from "../src/components/workflow/preview-adapter";

process.env.NEXT_PUBLIC_API_URL = "https://careiq.invalid";
const location = "0192e0b8-2b33-7000-8000-000000000001";

test("manager activity sends action dates, full actor identity, category, cursor and abort signal to its location-scoped read", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  const payload = { from: "2026-11-01", to: "2026-11-01", timeZone: "America/Los_Angeles", asOf: "2026-11-02T07:30:00Z", summary: { total: 0, appointments: 0, insurance: 0, followups: 0 }, actors: [{ id: "user_historical+identifier", label: "ntifier" }], items: [], pagination: { hasMore: false, nextCursor: null } } satisfies ManagerActivityPage;
  let received: { url: URL; options?: RequestInit } | undefined;
  globalThis.fetch = async (input, options) => { received = { url: new URL(String(input)), options }; return Response.json({ data: payload }); };
  try {
    const adapter = createInsuranceAdapter(location, async () => "synthetic-token", () => assert.fail("No denial expected"));
    assert.deepEqual(await adapter.managerActivity({ from: "2026-11-01", to: "2026-11-01", actorId: "user_historical+identifier", category: "insurance", cursor: "cursor+/=" }, controller.signal), payload);
    assert.equal(received?.url.pathname, `/api/v1/locations/${location}/insurance/manager/activity`);
    assert.equal(received?.url.searchParams.get("from"), "2026-11-01");
    assert.equal(received?.url.searchParams.get("to"), "2026-11-01");
    assert.equal(received?.url.searchParams.get("actorId"), "user_historical+identifier");
    assert.equal(received?.url.searchParams.get("category"), "insurance");
    assert.equal(received?.url.searchParams.get("cursor"), "cursor+/=");
    assert.equal(received?.url.searchParams.get("limit"), "50");
    assert.ok(received?.options?.signal instanceof AbortSignal);
    assert.equal(received?.options?.signal?.aborted, false);
    assert.equal(received?.options?.cache, "no-store");
    assert.equal(received?.options?.credentials, "omit");
  } finally { globalThis.fetch = original; }
});

test("manager activity revocation invokes the existing workspace denial flow", async () => {
  const original = globalThis.fetch; let denied = 0;
  globalThis.fetch = async () => Response.json({ error: { code: "FORBIDDEN", message: "FORBIDDEN" } }, { status: 403 });
  try {
    const adapter = createInsuranceAdapter(location, async () => "synthetic-token", () => denied++);
    await assert.rejects(adapter.managerActivity({ from: "2026-11-01", to: "2026-11-01" }));
    assert.equal(denied, 1);
  } finally { globalThis.fetch = original; }
});

test("explicit preview scopes activity by action day in the location time zone, independent of visit date", () => {
  const snapshot = previewSeed();
  snapshot.asOf = "2026-11-02T07:30:00Z"; // November 1, 23:30 after the Los Angeles DST change.
  snapshot.appointments[0].scheduledAt = "2026-12-15T18:00:00Z";
  const page = previewManagerActivity(snapshot, [], { from: "2026-11-01", to: "2026-11-01" });
  assert.equal(page.items.length, snapshot.appointments.length);
  assert.equal(page.timeZone, "America/Los_Angeles");
  assert.equal(page.items.find(item => item.entityId === snapshot.appointments[0].id)?.occurredAt, snapshot.asOf);
  assert.equal(previewManagerActivity(snapshot, [], { from: "2026-11-02", to: "2026-11-02" }).items.length, 0);
  const actor = page.actors[0].id;
  const filtered = previewManagerActivity(snapshot, [], { from: "2026-11-01", to: "2026-11-01", actorId: actor, category: "appointments" });
  assert.ok(filtered.items.every(item => item.actorId === actor));
  assert.equal(filtered.summary.total, filtered.items.length);
  assert.deepEqual(filtered.actors, page.actors);
});
