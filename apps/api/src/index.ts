import express from "express";
import { clerkMiddleware, getAuth } from '@clerk/express';
import cors from "cors";
import { pool } from "./db/client.js";
import { provisionPractice } from "./services/practice.service.js";
import { tenantContextMiddleware } from "./middleware/tenant-context.js";
import { sql } from "drizzle-orm";
import { withTenant } from "./db/with-tenant.js";

const app = express();

const port = Number(process.env.PORT ?? 3000);

app.use(
    cors({
        origin: "http://localhost:3001",
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
        console.error("Database health check failed:", error);

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
        console.error("Failed to resolve current user: ", error);

        res.status(500).json({
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Unable to resolve current user.",
            },
        });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`CareIQ API listening on port ${port}.`);
});