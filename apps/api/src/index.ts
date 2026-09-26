import express from "express";
import { clerkMiddleware, getAuth } from '@clerk/express';
import cors from "cors";
import { pool } from "./db/client.js";
import { provisionPractice } from "./services/practice.service.js";
import { tenantContextMiddleware } from "./middleware/tenant-context.js";
import { 
    createPatient,
    listPatients,
} from "./services/patient.service.js";
import {
    createAppointment,
    listAppointments,
} from "./services/appointment.service.js";

import { logFailure } from "./logging.js";
import { isUuid, parseScheduledAt } from "./validation.js";

const app = express();
app.disable("x-powered-by");

const port = Number(process.env.PORT ?? 3000);

app.use(
    cors({
        origin: (process.env.CORS_ORIGINS ?? "http://localhost:3001")
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
        credentials: true,
    }),
)

app.use(clerkMiddleware());
app.use(express.json());

app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");

        res.status(200).json({
            status: "ok",
            service: "careiq-api",
            database: "connected",
        });
    } catch(error) {
        logFailure("Database health check failed:", error);

        res.status(503).json({
            status: "error",
            service: "careiq-api",
            database: "disconnected"
        })
    }
});

app.get("/api/v1/me", async (req, res) => {
    try {
        const auth = getAuth(req);

        if(!auth.isAuthenticated) {
            res.status(401).json({
                error: {
                    code: "UNAUTHENTICATED",
                    message: "Authentication is required.",
                },
            });
            return;
        };

        if(!auth.orgId) {
            res.status(403).json({
                error: {
                    code: "ORGANIZATION_REQUIRED",
                    message: "An active organization is required.",
                },
            });
            return;
        }

        const practice = await provisionPractice(auth.orgId);

        res.status(200).json({
            data: {
                userId: auth.userId,
                orgId: auth.orgId,
                sessionId: auth.sessionId,
                practice,
            },
        });
    } catch(error) {
        logFailure("Failed to resolve current user: ", error);

        res.status(500).json({
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Unable to resolve current user.",
            },
        });
    }
});

app.get(
    "/api/v1/patients",
    tenantContextMiddleware,
    async(_req, res) => {
        try {
            const patients = await listPatients(res.locals.tenant);

            res.status(200).json({
                data: patients,
            });
        } catch(error) {
            logFailure("Failed to list patients: ", error);

            res.status(500).json({
                error: {
                    code: "PATIENT_LIST_FAILED",
                    message: "Unable to load patients.",
                },
            });
        }
    },
);

app.post(
    "/api/v1/patients",
    tenantContextMiddleware,
    async (req, res) => {
        try {
            const firstName =
            typeof req.body?.firstName === "string"
            ? req.body?.firstName.trim()
            : "";

            const lastName =
            typeof req.body?.lastName === "string"
            ? req.body?.lastName.trim()
            : "";

            const email =
            typeof req.body?.email === "string"
            ? req.body?.email.trim()
            : undefined;

            const phone =
            typeof req.body?.phone === "string"
            ? req.body?.phone.trim()
            : undefined;

            if(!firstName || !lastName) {
                res.status(400).json({
                    error: {
                        code: "INVALID_PATIENT",
                        message: "First name and last name are required.",
                    },
                });
                return;
            }

            const patient = await createPatient(res.locals.tenant, {
                firstName,
                lastName, 
                email,
                phone,
            });

            res.status(201).json({
                data: patient,
            });
        } catch (error) {
            logFailure("Failed to create patient: ", error);

            res.status(500).json({
                error: {
                    code: "PATIENT_CREATE_FAILED",
                    message: "Unable to create patient.",
                },
            });
        }
    },
);

app.get(
    "/api/v1/appointments",
    tenantContextMiddleware,
    async(_req, res) => {
        try{
            const appointments = await listAppointments(
                res.locals.tenant,
            );

            res.status(200).json({
                data: appointments,
            });
        } catch (error) {
            logFailure("Failed to list appointments: ", error);

            res.status(500).json({
                error: {
                    code: "APPOINTMENT_LIST_FAILED",
                    message: "Unable to load appointments."
                },
            });
        }
    },
);

app.post (
    "/api/v1/appointments",
    tenantContextMiddleware,
    async (req, res) => {
        try {
            const patientId = 
            typeof req.body?.patientId === "string"
            ? req.body?.patientId.trim()
            : "";

            const scheduledAt = 
            parseScheduledAt(req.body?.scheduledAt);

            const reason = 
            typeof req.body?.reason === "string"
            ? req.body?.reason.trim()
            : undefined;

            if(
                !isUuid(patientId) ||
                !scheduledAt ||
                Number.isNaN(scheduledAt.getTime())
            ) {
                res.status(400).json({
                    error: {
                        code: "INVALID_APPOINTMENT",
                        message: "Patient and a valid scheduled time are required.",
                    },
                });
                return;
            }

            const appointment = await createAppointment(
                res.locals.tenant,
                {
                    patientId,
                    scheduledAt,
                    reason,
                },
            );

            res.status(201).json({
                data: appointment,
            });
        } catch(error) {
            if(
                error instanceof Error &&
                error.message === "PATIENT_NOT_FOUND"
            ) {
                res.status(404).json({
                    error: {
                        code: "PATIENT_NOT_FOUND",
                        message: "The selected patient could not be found for this practice.",
                    },
                });
                return;
            }

            logFailure("Failed to create appointment: ", error);

            res.status(500).json({
                error: {
                    code: "APPOINTMENT_CREATE_FAILED",
                    message: "Unable to create appointment",
                },
            });
        }
    },
);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (error as { status?: number })?.status;
    if (status === 400 || status === 413) {
        res.status(status).json({ error: { code: "INVALID_REQUEST", message: status === 413 ? "Request body is too large." : "Request body must be valid JSON." } });
        return;
    }
    console.error("Unhandled request error");
    res.status(500).json({ error: { code: "INTERNAL_SERVER_ERROR", message: "Unable to complete request." } });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`CareIQ API listening on port ${port}.`);
});