import express, { type Request, type RequestHandler } from "express";
import cors from "cors";
import { logFailure } from "./logging.js";
import { createTenantContextMiddleware, type RequestAuthentication, type TenantContext } from "./middleware/tenant-context.js";
import { clinicalCapabilities, requireClinicalPermission } from "./middleware/permissions.js";
import { parseAppointmentInput, parseIdempotencyKey, parsePagination, parsePatientInput } from "./validation.js";
import { registerPublicInterviewRoutes, type InterviewRouteOptions } from "./routes/public-interview-requests.js";

type Pagination = { limit: number; offset: number };
type PatientInput = NonNullable<ReturnType<typeof parsePatientInput>>;
type AppointmentInput = NonNullable<ReturnType<typeof parseAppointmentInput>>;

export type ApiDependencies = {
  authenticate: RequestHandler;
  getAuth: (request: Request) => RequestAuthentication;
  health: () => Promise<unknown>;
  findPracticeByClerkOrgId: (orgId: string) => Promise<{ id: string } | null>;
  provisionPractice: (orgId: string) => Promise<unknown>;
  listPatients: (tenant: TenantContext, page: Pagination) => Promise<unknown[]>;
  listAppointments: (tenant: TenantContext, page: Pagination) => Promise<unknown[]>;
  createPatient: (tenant: TenantContext, input: PatientInput, idempotencyKey?: string) => Promise<unknown>;
  createAppointment: (tenant: TenantContext, input: AppointmentInput, idempotencyKey?: string) => Promise<unknown>;
};

export function createApiApp(dependencies: ApiDependencies, configuration: {
  origins: string[];
  trustedProxies: false | string[];
  interviews: Omit<InterviewRouteOptions, "origins">;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", configuration.trustedProxies);

  registerPublicInterviewRoutes(app, { ...configuration.interviews, origins: configuration.origins });
  app.use(cors({ origin: configuration.origins, credentials: true }));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health") {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
    }
    next();
  });
  app.get("/health", async (_req, res) => {
    try {
      await dependencies.health();
      res.status(200).json({ status: "ok", service: "careiq-api", database: "connected" });
    } catch (error) {
      logFailure("Database health check failed", error);
      res.status(503).json({ status: "error", service: "careiq-api", database: "disconnected" });
    }
  });

  app.use(dependencies.authenticate);
  app.use(express.json({ limit: "16kb" }));
  const tenantContextMiddleware = createTenantContextMiddleware(dependencies);

  app.get("/api/v1/me", async (req, res) => {
    try {
      const auth = dependencies.getAuth(req);
      if (!auth.isAuthenticated || !auth.userId) {
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } });
        return;
      }
      if (!auth.orgId) {
        res.status(403).json({ error: { code: "ORGANIZATION_REQUIRED", message: "An active organization is required." } });
        return;
      }
      const practice = await dependencies.provisionPractice(auth.orgId);
      res.status(200).json({ data: { userId: auth.userId, orgId: auth.orgId, sessionId: auth.sessionId, practice, capabilities: clinicalCapabilities(auth) } });
    } catch (error) {
      logFailure("Failed to resolve current user", error);
      res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to resolve current user." } });
    }
  });

  const listRoute = (resource: "patients" | "appointments"): RequestHandler => async (req, res) => {
    const page = parsePagination(req.query);
    if (!page) {
      res.status(400).json({ error: { code: "INVALID_PAGINATION", message: "Use a limit between 1 and 100 and a non-negative offset." } });
      return;
    }
    try {
      const list = resource === "patients" ? dependencies.listPatients : dependencies.listAppointments;
      const rows = await list(res.locals.tenant, { ...page, limit: page.limit + 1 });
      const hasMore = rows.length > page.limit;
      if (hasMore && req.query.limit === undefined) {
        res.status(409).json({ error: { code: "CLIENT_UPDATE_REQUIRED", message: "Refresh CareIQ to load the complete list of records." } });
        return;
      }
      res.status(200).json({ data: rows.slice(0, page.limit), meta: { ...page, hasMore, nextOffset: hasMore ? page.offset + page.limit : null } });
    } catch (error) {
      logFailure(`Failed to list ${resource}`, error);
      res.status(500).json({ error: { code: resource === "patients" ? "PATIENT_LIST_FAILED" : "APPOINTMENT_LIST_FAILED", message: `Unable to load ${resource}.` } });
    }
  };

  app.get("/api/v1/patients", tenantContextMiddleware, requireClinicalPermission("patients", "read"), listRoute("patients"));
  app.get("/api/v1/appointments", tenantContextMiddleware, requireClinicalPermission("appointments", "read"), listRoute("appointments"));

  const createRoute = (resource: "patients" | "appointments"): RequestHandler => async (req, res) => {
    const idempotencyKey = parseIdempotencyKey(req.get("Idempotency-Key"));
    if (idempotencyKey === null) {
      res.status(400).json({ error: { code: "INVALID_IDEMPOTENCY_KEY", message: "Idempotency-Key must be a UUID version 4." } });
      return;
    }
    const input = resource === "patients" ? parsePatientInput(req.body) : parseAppointmentInput(req.body);
    if (!input) {
      res.status(400).json({ error: {
        code: resource === "patients" ? "INVALID_PATIENT" : "INVALID_APPOINTMENT",
        message: resource === "patients" ? "Enter valid patient names and contact information within the field limits." : "Enter a valid patient, scheduled time and reason within the field limits.",
      } });
      return;
    }
    try {
      const record = resource === "patients"
        ? await dependencies.createPatient(res.locals.tenant, input as PatientInput, idempotencyKey)
        : await dependencies.createAppointment(res.locals.tenant, input as AppointmentInput, idempotencyKey);
      res.status(201).json({ data: record });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "IDEMPOTENCY_KEY_REUSED") {
        res.status(409).json({ error: { code, message: "This retry key was already used for a different request. Please start a new request." } });
        return;
      }
      if (code === "INVALID_IDEMPOTENCY_KEY") {
        res.status(400).json({ error: { code, message: "Idempotency-Key must be a UUID version 4." } });
        return;
      }
      if (resource === "appointments" && code === "PATIENT_NOT_FOUND") {
        res.status(404).json({ error: { code, message: "The selected patient could not be found for this practice." } });
        return;
      }
      logFailure(`Failed to create ${resource}`, error);
      res.status(500).json({ error: { code: resource === "patients" ? "PATIENT_CREATE_FAILED" : "APPOINTMENT_CREATE_FAILED", message: resource === "patients" ? "Unable to create patient." : "Unable to create appointment." } });
    }
  };

  app.post("/api/v1/patients", tenantContextMiddleware, requireClinicalPermission("patients", "create"), createRoute("patients"));
  app.post("/api/v1/appointments", tenantContextMiddleware, requireClinicalPermission("appointments", "create"), createRoute("appointments"));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (error as { status?: number })?.status;
    if (status === 400 || status === 413 || status === 415) {
      res.status(status).json({ error: { code: "INVALID_REQUEST", message: status === 413 ? "Request body is too large." : status === 415 ? "Request encoding is not supported." : "Request body must be valid JSON." } });
      return;
    }
    logFailure("Unhandled request error", error);
    res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to complete request." } });
  });
  return app;
}
