import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, apiRequest } from "../src/lib/api/client";
import { getAllPages } from "../src/lib/api/pagination";
import { createPatient } from "../src/lib/api/patients";
import { createAppointment } from "../src/lib/api/appointments";

process.env.NEXT_PUBLIC_API_URL = "https://careiq.invalid";

test("clinical requests send their attempt key and never use the browser cache", async t => {
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    requests.push(options);
    return Response.json({ data: { id: "synthetic" } });
  });
  await createPatient("test-session", { firstName: "Synthetic", lastName: "Patient" }, "patient-attempt");
  await createAppointment("test-session", { patientId: "synthetic", scheduledAt: "2026-10-04T12:00:00Z" }, "appointment-attempt");
  assert.equal(requests.length, 2);
  for (const [index, request] of requests.entries()) {
    assert.equal(request.cache, "no-store");
    const headers = new Headers(request.headers);
    assert.equal(headers.get("Authorization"), "Bearer test-session");
    assert.equal(headers.get("Idempotency-Key"), index ? "appointment-attempt" : "patient-attempt");
  }
});

test("a stalled save aborts with an actionable, retry-safe timeout message", async t => {
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  await assert.rejects(apiRequest("/api/v1/patients", "test-session", { method: "POST", headers: { "Idempotency-Key": "patient-attempt" }, timeoutMs: 5 }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "REQUEST_TIMEOUT");
    assert.match(error.message, /may have completed/);
    assert.match(error.message, /without changing the details/);
    return true;
  });
});

test("an uncertain non-idempotent change directs staff to refresh before repeating it", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Network unavailable"); });
  await assert.rejects(apiRequest("/api/v1/locations", "test-session", { method: "POST" }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.match(error.message, /Refresh to check before trying again/);
    assert.doesNotMatch(error.message, /avoid creating a duplicate/);
    return true;
  });
});

test("permission and idempotency conflicts preserve status and code", async t => {
  for (const [status, code] of [[403, "FORBIDDEN"], [409, "IDEMPOTENCY_KEY_REUSED"]] as const) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ error: { code, message: "A useful explanation" } }, { status }));
    await assert.rejects(apiRequest("/api/v1/patients", "test-session"), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.message, "A useful explanation");
      return true;
    });
    t.mock.restoreAll();
  }
});

test("pagination loads every server page without silently dropping later records", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return Response.json(url.endsWith("offset=0")
      ? { data: [{ id: "a" }], meta: { limit: 100, offset: 0, hasMore: true, nextOffset: 100 } }
      : { data: [{ id: "b" }], meta: { limit: 100, offset: 100, hasMore: false, nextOffset: null } });
  });
  assert.deepEqual(await getAllPages("/api/v1/patients", "test-session"), [{ id: "a" }, { id: "b" }]);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /limit=100&offset=100$/);
});

test("old unpaginated responses remain complete; invalid continuation stops safely", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{ id: "a" }] }));
  assert.deepEqual(await getAllPages("/api/v1/patients", "test-session"), [{ id: "a" }]);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [{ id: "a" }], meta: { hasMore: true, nextOffset: 0 } }));
  await assert.rejects(getAllPages("/api/v1/patients", "test-session"), /invalid page/);
});
