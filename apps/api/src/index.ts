import { clerkMiddleware, getAuth } from "@clerk/express";
import { createApiApp } from "./app.js";
import { pool } from "./db/client.js";
import { provisionPractice, findPracticeByClerkOrgId } from "./services/practice.service.js";
import { createPatient, listPatients } from "./services/patient.service.js";
import { createAppointment, listAppointments } from "./services/appointment.service.js";
import { createInterviewRequest } from "./services/interview-request.service.js";
import { interviewRequestsEnabled, parseCorsOrigins, parseTrustedProxies } from "./public-config.js";

const origins = parseCorsOrigins();
const app = createApiApp({
  authenticate: clerkMiddleware({ authorizedParties: origins }),
  getAuth,
  health: () => pool.query("SELECT 1"),
  provisionPractice,
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
