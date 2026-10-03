import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { clerkMiddleware, getAuth } from "@clerk/express";
import type { AddressInfo } from "node:net";
import { createApiApp, type ApiDependencies } from "../src/app.js";
import { clinicalCapabilities } from "../src/middleware/permissions.js";
import type { RequestAuthentication } from "../src/middleware/tenant-context.js";

const authenticated = (orgRole = "org:admin"): RequestAuthentication => ({ isAuthenticated: true, userId: "user_verified", orgId: "org_verified", orgRole, sessionId: "session_verified" });
const practiceId = randomUUID();
const validPatient = { firstName: " Demo ", lastName: " Patient ", email: "demo@example.com", phone: "+1 (415) 555-0100" };
const validAppointment = { patientId: randomUUID(), scheduledAt: "2026-10-02T12:00:00-07:00", reason: "Test appointment" };

async function withApi(auth: RequestAuthentication, overrides: Partial<ApiDependencies>, run: (base: string, calls: { operation: string; arguments: unknown[] }[]) => Promise<void>) {
  const calls: { operation: string; arguments: unknown[] }[] = [];
  const record = (operation: string, ...args: unknown[]) => { calls.push({ operation, arguments: args }); };
  const app = createApiApp({
    authenticate: (_req, _res, next) => next(),
    getAuth: () => auth,
    health: async () => true,
    findPracticeByClerkOrgId: async (orgId) => { record("findPractice", orgId); return { id: practiceId }; },
    provisionPractice: async (orgId) => { record("provisionPractice", orgId); return { id: practiceId }; },
    listPatients: async (...args) => { record("listPatients", ...args); return []; },
    listAppointments: async (...args) => { record("listAppointments", ...args); return []; },
    createPatient: async (...args) => { record("createPatient", ...args); return { id: randomUUID() }; },
    createAppointment: async (...args) => { record("createAppointment", ...args); return { id: randomUUID() }; },
    ...overrides,
  }, { origins: ["https://careiq.example"], trustedProxies: false, interviews: { enabled: false, store: async () => {}, log: () => {} } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

const post = (base: string, resource: string, body: unknown, key?: string) => fetch(`${base}/api/v1/${resource}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(key === undefined ? {} : { "Idempotency-Key": key }) }, body: JSON.stringify(body),
});

test("unauthenticated and missing-organization requests never reach clinical stores", async () => {
  for (const [auth, status] of [[{ isAuthenticated: false }, 401], [{ ...authenticated(), orgId: null }, 403]] as const) {
    await withApi(auth, {}, async (base, calls) => {
      for (const resource of ["patients", "appointments"]) {
        const response = await fetch(`${base}/api/v1/${resource}`);
        assert.equal(response.status, status);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal((await post(base, resource, resource === "patients" ? validPatient : validAppointment)).status, status);
      }
      assert.equal(calls.length, 0);
    });
  }
});

test("members can read but cannot create even when request body or permissions claim a write", async () => {
  await withApi({ ...authenticated("org:member"), has: () => true }, {}, async (base, calls) => {
    for (const resource of ["patients", "appointments"]) {
      assert.equal((await fetch(`${base}/api/v1/${resource}`)).status, 200);
      const response = await post(base, resource, { ...(resource === "patients" ? validPatient : validAppointment), role: "org:admin", capabilities: { create: true } });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).error.code, "FORBIDDEN");
    }
    assert.equal(calls.filter((call) => call.operation.startsWith("create")).length, 0);
    const me = await (await fetch(`${base}/api/v1/me`)).json();
    assert.deepEqual(me.data.capabilities, { patients: { read: true, create: false }, appointments: { read: true, create: false } });
  });
});

test("custom roles fail closed and require explicit resource permissions", () => {
  assert.deepEqual(clinicalCapabilities(authenticated("org:unknown")), { patients: { read: false, create: false }, appointments: { read: false, create: false } });
  const allowed = clinicalCapabilities({ ...authenticated("org:custom"), has: ({ permission }) => permission === "org:patients:read" });
  assert.deepEqual(allowed, { patients: { read: true, create: false }, appointments: { read: false, create: false } });
  assert.deepEqual(clinicalCapabilities({ ...authenticated(), orgId: null, has: () => true }), { patients: { read: false, create: false }, appointments: { read: false, create: false } });
});

test("administrators create normalized records in verified tenant scope and pass retry keys", async () => {
  await withApi(authenticated(), {}, async (base, calls) => {
    const key = randomUUID();
    const response = await post(base, "patients", { ...validPatient, practiceId: randomUUID() }, key.toUpperCase());
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await post(base, "appointments", validAppointment, key)).status, 201);
    const creations = calls.filter((call) => call.operation.startsWith("create"));
    assert.equal(creations.length, 2);
    assert.deepEqual(creations[0]?.arguments[0], { userId: "user_verified", orgId: "org_verified", practiceId });
    assert.deepEqual(creations[0]?.arguments[1], { ...validPatient, firstName: "Demo", lastName: "Patient" });
    assert.equal(creations[0]?.arguments[2], key);
  });
});

test("invalid clinical fields and retry headers are rejected before writes", async () => {
  await withApi(authenticated(), {}, async (base, calls) => {
    for (const body of [
      { ...validPatient, firstName: "a".repeat(121) }, { ...validPatient, lastName: "\u0000" },
      { ...validPatient, email: "not-an-email" }, { ...validPatient, phone: {} },
      { ...validPatient, email: "a".repeat(255) }, { ...validPatient, phone: "callback" },
    ]) assert.equal((await post(base, "patients", body)).status, 400);
    for (const body of [{ ...validAppointment, reason: "a".repeat(1001) }, { ...validAppointment, reason: "private\u0000data" }, { ...validAppointment, scheduledAt: "2026-02-30T12:00:00Z" }]) {
      assert.equal((await post(base, "appointments", body)).status, 400);
    }
    assert.equal((await post(base, "patients", validPatient, "not-a-key")).status, 400);
    assert.equal(calls.filter((call) => call.operation.startsWith("create")).length, 0);
  });
});

test("retry conflicts are safe 409 responses and legacy clients may omit the retry key", async () => {
  await withApi(authenticated(), { createPatient: async () => { throw new Error("IDEMPOTENCY_KEY_REUSED"); } }, async (base) => {
    const response = await post(base, "patients", validPatient, randomUUID());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "IDEMPOTENCY_KEY_REUSED");
  });
  await withApi(authenticated(), {}, async (base, calls) => {
    assert.equal((await post(base, "patients", validPatient)).status, 201);
    assert.equal(calls.find((call) => call.operation === "createPatient")?.arguments[2], undefined);
  });
});

test("lists are bounded and communicate the next page without silently truncating", async () => {
  const requested: unknown[] = [];
  await withApi(authenticated(), { listPatients: async (_tenant, page) => { requested.push(page); return [1, 2, 3]; } }, async (base) => {
    const response = await fetch(`${base}/api/v1/patients?limit=2&offset=4`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: [1, 2], meta: { limit: 2, offset: 4, hasMore: true, nextOffset: 6 } });
    assert.deepEqual(requested, [{ limit: 3, offset: 4 }]);
    for (const query of ["limit=101", "limit=0", "limit=2&limit=3", "offset=-1", "offset=1.5", "offset=1000001"]) {
      assert.equal((await fetch(`${base}/api/v1/patients?${query}`)).status, 400);
    }
  });
});

test("public intake and health remain independent of authentication", async () => {
  await withApi({ isAuthenticated: false }, { authenticate: (_req, _res, next) => next(new Error("Authentication unavailable")) }, async (base) => {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const response = await post(base, "public/interview-requests", {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "INTERVIEW_REQUESTS_UNAVAILABLE");
  });
});


test("Clerk verifies signatures and restricts authorized parties before tenant access", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwtKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  const token = (azp: string) => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "local-test-key" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "user_verified", sid: "sess_verified", iss: "https://clerk.example", azp,
      iat: timestamp, nbf: timestamp - 1, exp: timestamp + 60,
      org_id: "org_verified", org_role: "org:admin", org_permissions: [],
    })).toString("base64url");
    const data = `${header}.${payload}`;
    return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
  };
  const authenticate = clerkMiddleware({
    publishableKey: `pk_test_${Buffer.from("clerk.example$").toString("base64")}`,
    secretKey: "sk_test_synthetic_only",
    jwtKey,
    authorizedParties: ["https://careiq.example"],
  });
  await withApi(authenticated(), { authenticate, getAuth }, async (base, calls) => {
    const allowed = token("https://careiq.example");
    assert.equal((await fetch(`${base}/api/v1/patients`, { headers: { Authorization: `Bearer ${allowed}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/v1/patients`, { headers: { Authorization: `Bearer ${token("https://untrusted.example")}` } })).status, 401);
    const parts = allowed.split(".");
    parts[2] = Buffer.alloc(256).toString("base64url");
    assert.equal((await fetch(`${base}/api/v1/patients`, { headers: { Authorization: `Bearer ${parts.join(".")}` } })).status, 401);
    assert.equal(calls.filter((call) => call.operation === "listPatients").length, 1);
  });
});


test("legacy list clients cannot silently receive a truncated directory or calendar", async () => {
  const rows = Array.from({ length: 101 }, (_value, index) => ({ id: String(index) }));
  await withApi(authenticated(), { listPatients: async () => rows, listAppointments: async () => rows }, async (base) => {
    for (const resource of ["patients", "appointments"]) {
      const legacy = await fetch(`${base}/api/v1/${resource}`);
      assert.equal(legacy.status, 409);
      assert.equal(legacy.headers.get("cache-control"), "no-store");
      assert.deepEqual(await legacy.json(), { error: { code: "CLIENT_UPDATE_REQUIRED", message: "Refresh CareIQ to load the complete list of records." } });
      const current = await fetch(`${base}/api/v1/${resource}?limit=100&offset=0`);
      assert.equal(current.status, 200);
      const body = await current.json();
      assert.equal(body.data.length, 100);
      assert.deepEqual(body.meta, { limit: 100, offset: 0, hasMore: true, nextOffset: 100 });
    }
  });
  for (const size of [0, 99, 100]) {
    const complete = rows.slice(0, size);
    await withApi(authenticated(), { listPatients: async () => complete, listAppointments: async () => complete }, async (base) => {
      for (const resource of ["patients", "appointments"]) {
        const response = await fetch(`${base}/api/v1/${resource}`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { data: complete, meta: { limit: 100, offset: 0, hasMore: false, nextOffset: null } });
      }
    });
  }
});
