import { verifyWebhook } from "@clerk/backend/webhooks";
import { handleClerkEvent } from "./services/practice-reconciliation.js";
import { getAuth } from "@clerk/express";
import { createAuthenticationMiddleware } from "./middleware/authentication.js";
import { createApiApp } from "./app.js";
import { pool } from "./db/client.js";
import { findPracticeByClerkOrgId } from "./services/practice.service.js";
import { practiceAccess } from "./services/practice-access.service.js";
import { createPatient, listPatients } from "./services/patient.service.js";
import { createAppointment, listAppointments } from "./services/appointment.service.js";
import { createInterviewRequest } from "./services/interview-request.service.js";
import { interviewRequestsEnabled, parseClerkAuthenticationPolicy, parseTrustedProxies } from "./public-config.js";
import { validateProductionConfiguration } from "./production-config.js";
import { verifyDatabaseRelease } from "./db/release-check.js";
import { ReleaseCheckError } from "./db/migration-safety.js";
import { logFailure } from "./logging.js";

validateProductionConfiguration();
const authenticationPolicy = parseClerkAuthenticationPolicy();
const origins = authenticationPolicy.browserOrigins;
const app = createApiApp({
  authenticate: createAuthenticationMiddleware(authenticationPolicy),
  getAuth,
  health: () => pool.query("SELECT 1"),
  practiceAccess,
  clerkWebhook: async (body, headers) => {
    let event;
    if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) throw new Error("WEBHOOK_NOT_CONFIGURED");
    try {
      event = await verifyWebhook(new Request("https://api.careiq.invalid/api/v1/webhooks/clerk", { method: "POST", headers, body: new Uint8Array(body) }));
    } catch { throw Object.assign(new Error("INVALID_WEBHOOK"), { status: 400 }); }
    await handleClerkEvent(event, headers["svix-id"]);
  },
  findPracticeByClerkOrgId,
  createPatient,
  listPatients,
  createAppointment,
  listAppointments,
}, {
  origins,
  trustedProxies: parseTrustedProxies(),
  interviews: { store: createInterviewRequest, enabled: interviewRequestsEnabled() },
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST?.trim() || "0.0.0.0";
async function start() {
  if (process.env.NODE_ENV === "production") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await verifyDatabaseRelease(client, interviewRequestsEnabled());
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  app.listen(port, host, () => { console.log(`CareIQ API listening on port ${port}.`); });
}
start().catch(async (error) => {
  if (error instanceof ReleaseCheckError) console.error(error.message);
  else logFailure("API startup release verification failed", error);
  process.exitCode = 1;
  await pool.end();
});
