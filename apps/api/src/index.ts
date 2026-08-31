import express from "express"
import { clerkMiddleware, getAuth } from '@clerk/express'
import { pool } from "./db/client.js"

const app = express();

const port = Number(process.env.PORT ?? 3000);

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

app.get("/api/v1/me", (req, res) => {
    const auth = getAuth(req);

    if(!auth.isAuthenticated) {
        res.status(401).json({
            error: {
                code: "UNAUTHENTICATED",
                message: "Authentication is required.",
            },
        });
        return;
    }
    
    res.status(200).json({
        data: {
            userId: auth.userId,
            orgId: auth.orgId ?? null,
            sessionId: auth.sessionId,
        }
    })
})

app.listen(port, "0.0.0.0", () => {
    console.log(`CareIQ API listening on port ${port}.`);
});