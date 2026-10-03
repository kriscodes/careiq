import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import express from "express";
import { createInterviewRateLimiter } from "../src/middleware/interview-rate-limit.js";
import { INTERVIEW_REQUEST_PATH, registerPublicInterviewRoutes, type InterviewRouteOptions, type InterviewRequestLog } from "../src/routes/public-interview-requests.js";
import type { InterviewRequest } from "@careiq/interview-contract";

const valid = () => ({ name: " Example Person ", email: " person@gmail.com ", role: "practice_manager", practiceName: " Example Practice ", website: "", submissionKey: randomUUID() });

async function withApi(options: Partial<InterviewRouteOptions>, run: (base: string, records: InterviewRequest[], logs: InterviewRequestLog[]) => Promise<void>) {
  const records: InterviewRequest[] = [];
  const logs: InterviewRequestLog[] = [];
  const app = express();
  app.disable("x-powered-by");
  registerPublicInterviewRoutes(app, {
    enabled: true,
    origins: ["https://careiqlabs.com"],
    store: async (input) => { records.push(input); },
    log: (entry) => logs.push(entry),
    rateLimit: () => ({ allowed: true }),
    ...options,
  });
  // A guard sentinel proves that only POST and its exact OPTIONS route skip
  // subsequent authentication. It is not a substitute for Clerk verification.
  app.use((_req, res) => { res.status(401).json({ error: { code: "UNAUTHENTICATED" } }); });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, records, logs); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const send = (base: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${base}${INTERVIEW_REQUEST_PATH}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});

test("valid contact information is normalized, awaited and never echoed or logged", async () => {
  await withApi({}, async (base, records, logs) => {
    const response = await send(base, valid(), { Origin: "https://careiqlabs.com" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { accepted: true } });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://careiqlabs.com");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(records.length, 1);
    assert.equal(records[0]?.name, "Example Person");
    assert.equal(records[0]?.email, "person@gmail.com");
    assert.equal(records[0]?.practiceName, "Example Practice");
    assert.equal(logs[0]?.outcome, "accepted");
    assert.deepEqual(Object.keys(logs[0]!).sort(), ["durationMs", "event", "outcome", "requestId", "status"]);
    assert.doesNotMatch(JSON.stringify(logs), /Person|gmail|Practice/);
  });
});

test("success waits for the store promise; failure responses and logs are generic", async () => {
  let resolveStore!: () => void;
  let entered!: () => void;
  const storeEntered = new Promise<void>((resolve) => { entered = resolve; });
  const committed = new Promise<void>((resolve) => { resolveStore = resolve; });
  await withApi({ store: async () => { entered(); await committed; } }, async (base) => {
    let answered = false;
    const pending = send(base, valid()).then((response) => { answered = true; return response; });
    await storeEntered;
    assert.equal(answered, false);
    resolveStore();
    assert.equal((await pending).status, 200);
  });
  await withApi({ store: async () => { throw new Error("SQL: secret@example.com private-name DB_PASSWORD"); } }, async (base, _records, logs) => {
    const response = await send(base, valid());
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, "INTERVIEW_REQUEST_FAILED");
    assert.doesNotMatch(JSON.stringify({ body, logs }), /secret@example|private-name|SQL|DB_PASSWORD/);
    assert.equal(logs[0]?.outcome, "failed");
  });
});

test("invalid, oversized, honeypot, and unexpected fields never reach the store", async () => {
  await withApi({}, async (base, records) => {
    for (const body of [
      { ...valid(), name: "" }, { ...valid(), email: "invalid" }, { ...valid(), role: "admin" },
      { ...valid(), name: "a".repeat(121) }, { ...valid(), email: "a".repeat(255) },
      { ...valid(), practiceName: "a".repeat(161) }, { ...valid(), website: "bot-filled" },
      { ...valid(), submissionKey: "no" }, { ...valid(), practiceId: randomUUID() },
      { ...valid(), source: "client_source" }, { ...valid(), status: "approved" },
      { ...valid(), id: randomUUID() }, { ...valid(), organizationId: "org_fake" },
      { ...valid(), authorization: "admin" }, { ...valid(), newsletter: true }, null, [],
    ]) {
      const response = await send(base, body);
      assert.equal(response.status, 400);
      assert.doesNotMatch(JSON.stringify(await response.json()), /bot-filled|client_source|org_fake/);
    }
    assert.equal((await send(base, { ...valid(), name: "x".repeat(5000) })).status, 413);
    const malformed = await fetch(`${base}${INTERVIEW_REQUEST_PATH}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"name":' });
    assert.equal(malformed.status, 400);
    assert.equal((await send(base, valid(), { "Content-Type": "text/plain" })).status, 415);
    assert.equal((await send(base, valid(), { "Content-Encoding": "gzip" })).status, 415);
    assert.equal(records.length, 0);
  });
});

test("retry calls are acknowledged identically through the idempotent store contract", async () => {
  const keys = new Set<string>();
  const store = async (input: InterviewRequest) => { keys.add(input.submissionKey); };
  await withApi({ store }, async (base) => {
    const body = valid();
    const results = await Promise.all([send(base, body), send(base, body)]);
    for (const response of results) assert.deepEqual(await response.json(), { data: { accepted: true } });
    assert.equal(keys.size, 1);
  });
});

test("rate limits count invalid attempts and do not trust forwarded addresses by default", async () => {
  await withApi({ rateLimit: createInterviewRateLimiter({ perAddress: 2 }) }, async (base, records) => {
    assert.equal((await send(base, { ...valid(), website: "bot" }, { "X-Forwarded-For": "198.51.100.1" })).status, 400);
    assert.equal((await send(base, valid(), { "X-Forwarded-For": "198.51.100.2" })).status, 200);
    const response = await send(base, valid(), { "X-Forwarded-For": "198.51.100.3" });
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("Retry-After")) > 0);
    assert.equal((await response.json()).error.code, "RATE_LIMITED");
    assert.equal(records.length, 1);
  });
});

test("global and bounded-address quotas expire with their window", () => {
  let now = 0;
  const limit = createInterviewRateLimiter({ global: 2, perAddress: 2, windowMs: 1000, now: () => now });
  assert.equal(limit("one").allowed, true);
  assert.equal(limit("two").allowed, true);
  assert.deepEqual(limit("three"), { allowed: false, retryAfterSeconds: 1 });
  now = 1000;
  assert.equal(limit("three").allowed, true);
  const bounded = createInterviewRateLimiter({ global: 10, maxAddresses: 1, windowMs: 1000, now: () => now });
  assert.equal(bounded("one").allowed, true);
  assert.equal(bounded("two").allowed, false);
  now += 1000;
  assert.equal(bounded("two").allowed, true);
});

test("disabled submission and disallowed browser origins cannot save data", async () => {
  await withApi({ enabled: false }, async (base, records) => {
    const response = await send(base, valid());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "INTERVIEW_REQUESTS_UNAVAILABLE");
    assert.equal(records.length, 0);
  });
  await withApi({}, async (base, records) => {
    const response = await send(base, valid(), { Origin: "https://other.example" });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(records.length, 0);
  });
});

test("only exact POST and preflight bypass the next authentication middleware", async () => {
  await withApi({}, async (base) => {
    const preflight = await fetch(`${base}${INTERVIEW_REQUEST_PATH}`, { method: "OPTIONS", headers: { Origin: "https://careiqlabs.com", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "POST");
    for (const path of [INTERVIEW_REQUEST_PATH, `${INTERVIEW_REQUEST_PATH}/export`, "/api/v1/public", "/api/v1/patients", "/api/v1/appointments", "/api/v1/me"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 401);
    }
    for (const path of [`${INTERVIEW_REQUEST_PATH}/export`, "/api/v1/public", "/api/v1/patients", "/api/v1/appointments"]) {
      assert.equal((await fetch(`${base}${path}`, { method: "POST" })).status, 401);
    }
    assert.equal((await fetch(`${base}${INTERVIEW_REQUEST_PATH}`, { method: "DELETE" })).status, 401);
  });
  const source = await readFile(new URL("../src/app.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("registerPublicInterviewRoutes(app") < source.indexOf("app.use(dependencies.authenticate)"));
  assert.ok(source.indexOf("app.use(dependencies.authenticate)") < source.indexOf('app.get("/api/v1/me"'));
});
