import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/lib/api/client";
import { getPatients, createPatient } from "../src/lib/api/patients";
import { getAppointments, createAppointment } from "../src/lib/api/appointments";

process.env.NEXT_PUBLIC_API_URL = "https://careiq.invalid";
const location = "0192e0b8-2b33-7000-8000-000000000001";
const patientInput = { firstName: "Synthetic", lastName: "Patient" };
const appointmentInput = { patientId: "synthetic", scheduledAt: "2026-10-05T12:00:00Z" };

test("every page of a clinical directory stays bound to its selected location and token", async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    requests.push(url);
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer selected-practice-token");
    assert.equal(options.cache, "no-store");
    return Response.json(url.endsWith("offset=0")
      ? { data: [{ id: "first" }], meta: { hasMore: true, nextOffset: 100 } }
      : { data: [{ id: "first" }, { id: "second" }], meta: { hasMore: false, nextOffset: null } });
  });
  for (const [resource, load] of [["patients", getPatients], ["appointments", getAppointments]] as const) {
    const result = await load("selected-practice-token", location);
    assert.deepEqual(result, [{ id: "first" }, { id: "second" }]);
    assert.deepEqual(requests.splice(0), [
      `https://careiq.invalid/api/v1/locations/${location}/${resource}?limit=100&offset=0`,
      `https://careiq.invalid/api/v1/locations/${location}/${resource}?limit=100&offset=100`,
    ]);
  }
});

test("clinical saves retain explicit location, attempt key, and cancellation", async t => {
  const controller = new AbortController();
  const requests: { url: string; options: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    requests.push({ url, options });
    assert.ok(options.signal);
    assert.equal(options.signal.aborted, false);
    return Response.json({ data: { id: "created" } });
  });
  await createPatient("selected-token", patientInput, "patient-attempt", location, controller.signal);
  await createAppointment("selected-token", appointmentInput, "appointment-attempt", location, controller.signal);
  assert.equal(requests.length, 2);
  for (const [index, { url, options }] of requests.entries()) {
    assert.equal(url, `https://careiq.invalid/api/v1/locations/${location}/${index ? "appointments" : "patients"}`);
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).get("Idempotency-Key"), index ? "appointment-attempt" : "patient-attempt");
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer selected-token");
  }
});

test("an invalid explicit location fails before any clinical request", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ data: [] }); });
  for (const invalid of ["", "../patients", `${location}?all=true`, "not-a-location"]) {
    await assert.rejects(getPatients("token", invalid), /valid location/);
    await assert.rejects(getAppointments("token", invalid), /valid location/);
    await assert.rejects(createPatient("token", patientInput, "attempt", invalid), /valid location/);
    await assert.rejects(createAppointment("token", appointmentInput, "attempt", invalid), /valid location/);
  }
  assert.equal(requests, 0);
});

test("location denial never retries the unscoped legacy endpoint", async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    return Response.json({ error: { code: "LOCATION_ACCESS_DENIED", message: "Location access was removed." } }, { status: 403 });
  });
  await assert.rejects(getPatients("token", location), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 403);
    assert.equal(error.code, "LOCATION_ACCESS_DENIED");
    return true;
  });
  assert.deepEqual(requests, [`https://careiq.invalid/api/v1/locations/${location}/patients?limit=100&offset=0`]);
});

test("a context cancelled before dispatch cannot start reads or save an old draft", async t => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({ data: [] }); });
  await assert.rejects(getPatients("old-token", location, controller.signal), { name: "AbortError" });
  await assert.rejects(getAppointments("old-token", location, controller.signal), { name: "AbortError" });
  await assert.rejects(createPatient("old-token", patientInput, "old-attempt", location, controller.signal), { name: "AbortError" });
  await assert.rejects(createAppointment("old-token", appointmentInput, "old-attempt", location, controller.signal), { name: "AbortError" });
  assert.equal(requests, 0);
});

test("cancelling while a buffered page is read prevents continuation and returning stale records", async t => {
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    const response = Response.json({});
    t.mock.method(response, "json", async () => {
      controller.abort();
      return { data: [{ id: "old-location-record" }], meta: { hasMore: true, nextOffset: requests * 100 } };
    });
    if (requests > 1) throw new Error("Pagination continued after cancellation");
    return response;
  });
  await assert.rejects(getPatients("token", location, controller.signal));
  assert.equal(requests, 1, "Cancelled location work must not request another page");
});

test("cancelling a later page rejects the entire list instead of exposing a partial directory", async t => {
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    requests++;
    if (requests === 1) return Response.json({ data: [{ id: "first" }], meta: { hasMore: true, nextOffset: 100 } });
    return new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      controller.abort();
    });
  });
  await assert.rejects(getAppointments("token", location, controller.signal), { name: "AbortError" });
  assert.equal(requests, 2);
});
