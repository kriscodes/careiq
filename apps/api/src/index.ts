import { verifyWebhook } from "@clerk/backend/webhooks";
import { handleClerkEvent } from "./services/practice-reconciliation.js";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { createApiApp } from "./app.js";
import { pool } from "./db/client.js";
import { findPracticeByClerkOrgId } from "./services/practice.service.js";
import { practiceAccess } from "./services/practice-access.service.js";
import { createPatient, listPatients } from "./services/patient.service.js";
import { createAppointment, listAppointments } from "./services/appointment.service.js";
import { createInterviewRequest } from "./services/interview-request.service.js";
import { interviewRequestsEnabled, parseCorsOrigins, parseTrustedProxies } from "./public-config.js";

const origins = parseCorsOrigins();
const app = createApiApp({
  authenticate: clerkMiddleware({ authorizedParties: origins }),
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
app.listen(port, "0.0.0.0", () => {
  console.log(`CareIQ API listening on port ${port}.`);
});
