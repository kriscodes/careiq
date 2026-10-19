import assert from "node:assert/strict";
import test from "node:test";
import { communicationPath, createCommunicationsAdapter, eligibleCommunicationEndpoints, boundCommunicationEndpoints, deliveryNeedsAttention, type CommunicationEndpoint } from "../src/lib/api/communications";
import { ApiError } from "../src/lib/api/client";
process.env.NEXT_PUBLIC_API_URL = "https://careiq.invalid";
const location = "0192e0b8-2b33-7000-8000-000000000001";

test("communications require explicit location scope and reject route escapes", () => {
  assert.equal(communicationPath(location, "deliveries"), `/api/v1/locations/${location}/communications/deliveries`);
  assert.equal(communicationPath(location, "notifications", true), `/api/v1/locations/${location}/workflow/notifications`);
  for (const resource of ["../deliveries", "/deliveries", "deliveries#wrong"]) assert.throws(() => communicationPath(location, resource));
  assert.throws(() => communicationPath("all-locations", "deliveries"));
});
test("patient channel selection requires active verified contact and independent purpose permission", () => {
  const base: CommunicationEndpoint = { id: "confirmed", channel: "email", maskedDestination: "a***@example.test", status: "active", verifiedAt: "2026-10-18T12:00:00Z", timeZone: null, permissions: { request: true, reminder: false, paperwork: true } };
  const choices = [base, { ...base, id: "unconfirmed", verifiedAt: null }, { ...base, id: "suppressed", status: "suppressed" }, { ...base, id: "inactive", status: "inactive" }, { ...base, id: "unknown", status: "unknown" }, { ...base, id: "reminder-only", permissions: { request: false, reminder: true, paperwork: false } }];
  assert.deepEqual(eligibleCommunicationEndpoints(choices, "initial").map(item => item.id), ["confirmed"]);
  assert.deepEqual(eligibleCommunicationEndpoints(choices, "reminder").map(item => item.id), ["reminder-only"]);
  assert.deepEqual(eligibleCommunicationEndpoints(choices, "reissue").map(item => item.id), ["confirmed"]);
});
test("patient send retries preserve the stable key and request revision without inventing a destination", async () => {
  const original = globalThis.fetch; const calls: Array<{ url: string; options: RequestInit; headers: Headers; body: unknown }> = [];
  globalThis.fetch = async (input, options = {}) => { calls.push({ url: String(input), options, headers: new Headers(options.headers), body: JSON.parse(String(options.body)) }); return Response.json({ data: { id: "request-1", state: "queued", intents: [] } }); };
  try {
    const adapter = createCommunicationsAdapter(location, async () => "synthetic-test-token", () => assert.fail("Unexpected denial")); const body = { purpose: "reminder" as const, endpointIds: ["endpoint-1"] };
    await adapter.queue("request-1", body, { key: "original-operation", revision: 9 }); await adapter.queue("request-1", body, { key: "original-operation", revision: 9 });
    assert.equal(calls[0].url, `https://careiq.invalid/api/v1/locations/${location}/communications/requests/request-1/deliveries`);
    assert.deepEqual(calls[0].body, body); assert.equal(calls[0].headers.get("If-Match"), '"9"'); assert.equal(calls[0].headers.get("Idempotency-Key"), calls[1].headers.get("Idempotency-Key"));
    assert.equal(calls[0].headers.get("Authorization"), "Bearer synthetic-test-token"); assert.equal(calls[0].options.cache, "no-store"); assert.equal(calls[0].options.credentials, "omit"); assert.equal(calls[0].options.referrerPolicy, "no-referrer");
  } finally { globalThis.fetch = original; }
});
test("staff reads use recipient revision and mark-all uses only the server cutoff token", async () => {
  const original = globalThis.fetch; const calls: Array<{ url: string; body: unknown; headers: Headers }> = [];
  globalThis.fetch = async (input, options) => { calls.push({ url: String(input), body: JSON.parse(String(options?.body)), headers: new Headers(options?.headers) }); return Response.json({ data: { id: "notice", readAt: "2026-10-18T13:00:00Z", revision: 3, updatedCount: 1, unreadCount: 0 } }); };
  try {
    const adapter = createCommunicationsAdapter(location, async () => "synthetic-token", () => {});
    await adapter.read("notice", true, { key: "receipt-operation", revision: 2 }); await adapter.readAll("signed-authorized-cutoff", { key: "all-operation" });
    assert.ok(calls[0].url.endsWith("/workflow/notifications/notice/read")); assert.deepEqual(calls[0].body, { read: true }); assert.equal(calls[0].headers.get("If-Match"), '"2"');
    assert.deepEqual(calls[1].body, { snapshotToken: "signed-authorized-cutoff" }); assert.equal(calls[1].headers.get("Idempotency-Key"), "all-operation"); assert.equal(calls[1].headers.has("If-Match"), false);
  } finally { globalThis.fetch = original; }
});
test("read-only inbox fetches encode server filters and cursors and never mutate source work", async () => {
  const original = globalThis.fetch; let url = ""; let method: string | undefined;
  globalThis.fetch = async (input, options) => { url = String(input); method = options?.method; return Response.json({ data: { items: [], unreadCount: 0, pagination: { hasMore: false, nextCursor: null } } }); };
  try { const adapter = createCommunicationsAdapter(location, async () => "test-token", () => {}); await adapter.inbox("unread", "cursor&other=true"); assert.ok(url.endsWith("filter=unread&limit=50&cursor=cursor%26other%3Dtrue")); assert.equal(method, undefined); }
  finally { globalThis.fetch = original; }
});
test("communications permissions denial triggers protected-context removal instead of empty success", async () => {
  const original = globalThis.fetch; let denied = 0; globalThis.fetch = async () => Response.json({ error: { code: "FORBIDDEN", message: "Access changed" } }, { status: 403 });
  try { const adapter = createCommunicationsAdapter(location, async () => "test-token", () => denied++); await assert.rejects(adapter.deliveries(), (cause: unknown) => cause instanceof ApiError && cause.status === 403); assert.equal(denied, 1); }
  finally { globalThis.fetch = original; }
});
test("delivery attention groups failure without treating provider receipt as paperwork completion", () => {
  for (const state of ["failed", "unknown", "bounced", "suppressed"]) assert.equal(deliveryNeedsAttention({ state } as never), true);
  for (const state of ["queued", "accepted", "delivered", "completed"]) assert.equal(deliveryNeedsAttention({ state } as never), false);
});

test("an uncertain send remains bound to its original payload and operation across composer reopen", async () => {
  const original = globalThis.fetch; const keys: string[] = []; let fail = true;
  globalThis.fetch = async (_input, options) => { keys.push(new Headers(options?.headers).get("Idempotency-Key")!); if (fail) { fail = false; throw new Error("Synthetic lost response after queue"); } return Response.json({ data: { id: "request-1", state: "queued", intents: [] } }); };
  try {
    const adapter = createCommunicationsAdapter(location, async () => "test-token", () => {}); const body = { purpose: "initial" as const, endpointIds: ["endpoint-1"] };
    await assert.rejects(adapter.queue("request-1", body, { key: "original-send", revision: 2 }));
    await assert.rejects(adapter.queue("request-1", { purpose: "reminder", endpointIds: ["endpoint-1"] }, { key: "new-send", revision: 2 }), (cause: unknown) => cause instanceof ApiError && cause.code === "SEND_RESULT_UNKNOWN");
    await adapter.queue("request-1", body, { key: "reopened-composer", revision: 3 }); assert.deepEqual(keys, ["original-send", "original-send"]);
  } finally { globalThis.fetch = original; }
});

test("bound request choices do not silently select another channel or destination", () => {
  const base: CommunicationEndpoint = { id: "email-1", channel: "email", maskedDestination: "a•••@example.test", status: "active", verifiedAt: "2026-10-18T12:00:00Z", timeZone: null, permissions: { request: true, reminder: true, paperwork: false } };
  const choices = [base, { ...base, id: "different-address", maskedDestination: "b•••@example.test" }, { ...base, id: "sms-1", channel: "sms" as const, maskedDestination: "••• ••• 0123" }];
  assert.deepEqual(boundCommunicationEndpoints(choices, { recipientEmail: "alex@example.test" }).map(item => item.id), ["email-1"]);
  assert.deepEqual(boundCommunicationEndpoints(choices, { recipientEmail: "alex@example.test", recipientPhone: "+12025550123" }).map(item => item.id), ["email-1", "sms-1"]);
  assert.deepEqual(boundCommunicationEndpoints(choices, {}).map(item => item.id), []);
});
test("explicit reissue transmits a reason and selected confirmed destinations with the exact request revision", async () => {
  const original = globalThis.fetch; let sent: unknown; let headers: Headers | undefined;
  globalThis.fetch = async (_input, options) => { sent = JSON.parse(String(options?.body)); headers = new Headers(options?.headers); return Response.json({ data: { id: "request-1", state: "queued", revision: 3, intents: [] } }); };
  try { const adapter = createCommunicationsAdapter(location, async () => "test-token", () => {}); await adapter.queue("request-1", { purpose: "reissue", endpointIds: ["email-endpoint", "sms-endpoint"], reasonCode: "channel_changed" }, { key: "explicit-reissue", revision: 2 }); assert.deepEqual(sent, { purpose: "reissue", endpointIds: ["email-endpoint", "sms-endpoint"], reasonCode: "channel_changed" }); assert.equal(headers?.get("If-Match"), '\"2\"'); }
  finally { globalThis.fetch = original; }
});
test("verified destination registration and permission changes retain distinct preconditions", async () => {
  const original = globalThis.fetch; const requests: Array<{ url: string; body: unknown; headers: Headers; method?: string }> = [];
  globalThis.fetch = async (input, options) => { requests.push({ url: String(input), body: JSON.parse(String(options?.body)), headers: new Headers(options?.headers), method: options?.method }); return Response.json({ data: { id: "endpoint-1", revision: 3, state: "active" } }); };
  try { const adapter = createCommunicationsAdapter(location, async () => "test-token", () => {}); const permissions = { request: true, reminder: false, paperwork: false }; await adapter.registerEndpoint("patient-1", { channel: "email", address: "synthetic@example.test", confirmed: true, verificationReference: "Synthetic verification", timeZone: null, permissions }, { revision: 7, key: "register-destination" }); await adapter.updateEndpointPermissions("endpoint-1", { permissions, verificationReference: "Synthetic confirmation" }, { revision: 2, key: "record-permissions" }); assert.equal(requests[0].method, "PUT"); assert.equal(requests[0].headers.get("If-Match"), '\"7\"'); assert.equal(requests[1].method, "POST"); assert.equal(requests[1].headers.get("If-Match"), '\"2\"'); assert.ok(requests[1].url.endsWith("/endpoints/endpoint-1/permissions")); }
  finally { globalThis.fetch = original; }
});
