import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { createApiApp, type ApiDependencies } from "../src/app.js";
import { INTERVIEW_REQUEST_PATH } from "../src/routes/public-interview-requests.js";

test("every API body parser rejects compressed requests before business handlers and keeps serving health", async () => {
  // Failure-audit writes use a fake client. No database connection is made.
  process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic";
  process.env.DATABASE_SSL_MODE = "disable";
  const { pool } = await import("../src/db/client.js");
  const connection = mock.method(pool, "connect", async () => ({
    query: async () => ({ rows: [{ id: randomUUID() }], rowCount: 1 }),
    release() {},
  }));
  const practiceId = randomUUID(), locationId = randomUUID(), uploadId = randomUUID();
  const tenant = { practiceId, locationId, userId: "user_Synthetic", orgId: "org_Synthetic", membershipId: "orgmem_Synthetic" };
  let handled = 0;
  const handledResult = async () => { handled++; return { id: randomUUID() }; };
  const dependencies: ApiDependencies = {
    authenticate: (_req, _res, next) => next(),
    getAuth: () => ({ isAuthenticated: true, userId: tenant.userId, orgId: tenant.orgId, orgRole: "org:admin", sessionId: "sess_Synthetic" }),
    health: async () => true,
    findPracticeByClerkOrgId: async () => ({ id: practiceId }),
    listPatients: async () => [],
    listAppointments: async () => [],
    createPatient: handledResult,
    createAppointment: handledResult,
    clerkWebhook: async (bytes) => { assert.deepEqual(bytes, Buffer.from('{}')); handled++; },
    practiceAccess: {
      authorizeLocation: async () => ({ tenant, capabilities: { patients: { read: true, create: true }, appointments: { read: true, create: true } }, permissions: ["org:documents:upload"] }),
    } as unknown as NonNullable<ApiDependencies["practiceAccess"]>,
    workflow: {
      execute: handledResult,
      putUpload: handledResult,
      patientUploadContent: handledResult,
      exchangePatientSession: async () => { handled++; return { requestId: randomUUID(), sessionToken: "synthetic-session", expiresAt: new Date(Date.now() + 60000).toISOString() }; },
    } as unknown as NonNullable<ApiDependencies["workflow"]>,
    deliveryCallbacks: { env: {}, resolveTenant: async () => { handled++; return tenant; } },
  };
  const app = createApiApp(dependencies, { origins: ["https://careiq.example"], trustedProxies: false, interviews: { enabled: true, store: async () => { handled++; }, rateLimit: () => ({ allowed: true }), log: () => {} } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cases = [
    { method: "POST", path: "/api/v1/patients", type: "application/json" },
    { method: "POST", path: `/api/v1/locations/${locationId}/workflow/patients`, type: "application/json" },
    { method: "POST", path: "/api/v1/patient-workflows/session-exchanges", type: "application/json" },
    { method: "PUT", path: `/api/v1/locations/${locationId}/workflow/uploads/${uploadId}/content`, type: "application/octet-stream" },
    { method: "PUT", path: `/api/v1/patient-workflows/uploads/${uploadId}/content`, type: "application/octet-stream" },
    { method: "POST", path: "/api/v1/webhooks/clerk", type: "application/json" },
    { method: "POST", path: "/api/v1/delivery-callbacks/synthetic/resend", type: "application/json" },
    { method: "POST", path: "/api/v1/delivery-callbacks/synthetic/twilio", type: "application/x-www-form-urlencoded" },
    { method: "POST", path: "/api/v1/delivery-callbacks/synthetic/twilio-inbound", type: "application/x-www-form-urlencoded" },
    { method: "POST", path: INTERVIEW_REQUEST_PATH, type: "application/json" },
  ];
  const encodings = { br: brotliCompressSync, gzip: gzipSync, deflate: deflateSync };
  try {
    for (const endpoint of cases) for (const [encoding, compress] of Object.entries(encodings)) {
      const body = compress(Buffer.from(endpoint.type === "application/x-www-form-urlencoded" ? "MessageSid=synthetic" : "{}"));
      const response = await fetch(base + endpoint.path, { method: endpoint.method, headers: { "Content-Type": endpoint.type, "Content-Encoding": encoding }, body });
      assert.equal(response.status, 415, `${endpoint.path}: ${encoding}`);
      await response.arrayBuffer();
      assert.equal(handled, 0, `${endpoint.path}: ${encoding} reached a business handler`);
      assert.equal((await fetch(base + "/health")).status, 200);
    }
    const plainPatient = await fetch(base + "/api/v1/patients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firstName: "Synthetic", lastName: "Patient" }) });
    assert.equal(plainPatient.status, 201);
    const plainWebhook = await fetch(base + "/api/v1/webhooks/clerk", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(plainWebhook.status, 200);
    assert.equal(handled, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    connection.mock.restore();
    await pool.end();
  }
});
