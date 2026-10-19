import assert from "node:assert/strict";
import test from "node:test";
import { createInsuranceAdapter, insuranceAmount, insurancePath } from "../src/lib/api/insurance";
process.env.NEXT_PUBLIC_API_URL = "https://careiq.invalid";
const location = "0192e0b8-2b33-7000-8000-000000000001";

test("insurance amounts preserve unknown separately from confirmed zero and reject malformed amounts", () => {
  assert.equal(insuranceAmount("", true), null); assert.equal(insuranceAmount("  "), null);
  assert.equal(insuranceAmount("0", true), 0); assert.equal(insuranceAmount("27.05", true), 2705);
  for (const value of ["-1", "1e3", "Infinity", "2.999", "abc"]) assert.throws(() => insuranceAmount(value, true));
});

test("insurance routes require the explicit location and reject path escapes", () => {
  assert.equal(insurancePath(location, "cases"), `/api/v1/locations/${location}/insurance/cases`);
  assert.throws(() => insurancePath("missing", "cases")); assert.throws(() => insurancePath(location, "../cases")); assert.throws(() => insurancePath(location, "/cases"));
});

test("real insurance mutations carry the caller's stable attempt key and exact case revision", async () => {
  const original = globalThis.fetch; const calls: Array<{ headers: Headers; body: unknown; url: string; options?: RequestInit }> = [];
  globalThis.fetch = async (input, options) => { calls.push({ url: String(input), headers: new Headers(options?.headers), body: JSON.parse(String(options?.body)), options }); return Response.json({ data: { id: "case-1", revision: 8, state: "active" } }); };
  try {
    const adapter = createInsuranceAdapter(location, async () => "synthetic-test-token", () => assert.fail("No denial expected"));
    const command = { source: "phone" as const, observedAt: "2026-10-18T15:00:00Z", reference: "Synthetic reference", outcome: "active" as const, reasonCode: "manual_verification" as const, copayCents: 0, deductibleRemainingCents: null };
    await adapter.evidence("case-1", command, { key: "same-attempt", revision: 7 }); await adapter.evidence("case-1", command, { key: "same-attempt", revision: 7 });
    assert.equal(calls[0].headers.get("If-Match"), '"7"'); assert.equal(calls[0].headers.get("Idempotency-Key"), calls[1].headers.get("Idempotency-Key"));
    assert.equal(calls[0].headers.get("Authorization"), "Bearer synthetic-test-token"); assert.deepEqual(calls[0].body, command);
    assert.equal(calls[0].options?.cache, "no-store"); assert.equal(calls[0].options?.credentials, "omit"); assert.equal(calls[0].options?.referrerPolicy, "no-referrer");
  } finally { globalThis.fetch = original; }
});

test("case detail consumes only the safe history and preserves evidence pagination", async () => {
  const original = globalThis.fetch; const requests: string[] = [];
  globalThis.fetch = async input => { requests.push(String(input)); return Response.json(String(input).includes("/activity?") ? { data: [{ id: "event-1", action: "insurance.evidence.recorded", occurredAt: "2026-10-18T16:00:00Z", actorType: "staff", actorId: "synthetic-staff-12345678", outcome: "success" }], pagination: { hasMore: true, nextCursor: "history-next" } } : { data: { case: { id: "case-1", state: "active", revision: 2 }, evidence: [{ id: "evidence-1", createdAt: "2026-10-18T16:00:00Z", observedAt: "2026-10-18T15:00:00Z", copayCents: 0 }], evidencePagination: { hasMore: true, nextCursor: "evidence-next" } }, meta: { capabilities: { read: true, manage: true, evidence: false, activity: true } } }); };
  try {
    const detail = await createInsuranceAdapter(location, async () => "synthetic-token", () => {}).detail("case-1");
    assert.equal(detail.case.status, "active"); assert.deepEqual(detail.case.allowedActions, ["follow_up"]);
    assert.equal(detail.evidence[0].recordedAt, "2026-10-18T16:00:00Z"); assert.equal(detail.evidence[0].copayCents, 0);
    assert.equal(detail.evidenceCursor, "evidence-next"); assert.equal(detail.activityCursor, "history-next");
    assert.equal(detail.activity[0].actorLabel, "staff · 12345678"); assert.equal(requests.length, 2); assert.ok(requests.every(url => !url.includes("/audit")));
  } finally { globalThis.fetch = original; }
});

test("case detail avoids activity access when the server does not grant it and clears access on denial", async () => {
  const original = globalThis.fetch; let count = 0; let denied = 0;
  globalThis.fetch = async () => { count++; return Response.json({ data: { case: { id: "case-1", state: "unverified", revision: 1 }, evidence: [] }, meta: { capabilities: { read: true, manage: false, evidence: false, activity: false } } }); };
  try {
    const adapter = createInsuranceAdapter(location, async () => "synthetic-token", () => denied++);
    const detail = await adapter.detail("case-1"); assert.equal(count, 1); assert.deepEqual(detail.case.allowedActions, []); assert.deepEqual(detail.activity, []);
    globalThis.fetch = async () => Response.json({ error: { code: "FORBIDDEN", message: "Access revoked" } }, { status: 403 });
    await assert.rejects(adapter.cases("2026-10-18", "2026-10-18")); assert.equal(denied, 1);
  } finally { globalThis.fetch = original; }
});
