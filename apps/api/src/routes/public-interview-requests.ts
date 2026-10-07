import { randomUUID } from "node:crypto";
import express, { type Express, type Request, type Response, type NextFunction, type RequestHandler, type ErrorRequestHandler } from "express";
import cors from "cors";
import { parseInterviewRequest, type InterviewRequest } from "@careiq/interview-contract";
import { createInterviewRateLimiter, type RateLimitResult } from "../middleware/interview-rate-limit.js";

export const INTERVIEW_REQUEST_PATH = "/api/v1/public/interview-requests";

export type InterviewRequestLog = {
  event: "public_interview_request";
  requestId: string;
  outcome: string;
  status: number;
  durationMs: number;
};

export type InterviewRouteOptions = {
  store: (input: InterviewRequest) => Promise<void>;
  origins: string[];
  enabled: boolean;
  rateLimit?: (address: string) => RateLimitResult;
  log?: (entry: InterviewRequestLog) => void;
};

/** Mount this exact route before Clerk. This module never imports the database or tenant middleware. */
export function registerPublicInterviewRoutes(app: Express, options: InterviewRouteOptions): void {
  const rateLimit = options.rateLimit ?? createInterviewRateLimiter();
  const log = options.log ?? ((entry) => console.info(entry));
  const publicCors = cors({ origin: options.origins, methods: ["POST"], allowedHeaders: ["Content-Type"], exposedHeaders: ["Retry-After", "X-Request-Id"], maxAge: 600 });

  const observe: RequestHandler = (_req, res, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    res.locals.interviewRequestId = requestId;
    res.locals.interviewOutcome = "rejected";
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.once("finish", () => log({
      event: "public_interview_request",
      requestId,
      outcome: res.locals.interviewOutcome as string,
      status: res.statusCode,
      durationMs: Math.max(0, Math.round(performance.now() - started)),
    }));
    next();
  };

  const checkOrigin: RequestHandler = (req, res, next) => {
    const origin = req.get("Origin");
    if (origin && !options.origins.includes(origin)) {
      res.status(403).json({ error: { code: "ORIGIN_NOT_ALLOWED", message: "This website cannot submit requests.", requestId: res.locals.interviewRequestId } });
      return;
    }
    next();
  };

  // Do not mount a public router prefix or a wildcard authentication exemption.
  app.options(INTERVIEW_REQUEST_PATH, checkOrigin, publicCors);
  app.post(
    INTERVIEW_REQUEST_PATH,
    observe,
    checkOrigin,
    publicCors,
    (req: Request, res: Response, next: NextFunction) => {
      const limit = rateLimit(req.ip ?? req.socket.remoteAddress ?? "unknown");
      if (!limit.allowed) {
        res.locals.interviewOutcome = "rate_limited";
        res.setHeader("Retry-After", limit.retryAfterSeconds);
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later.", requestId: res.locals.interviewRequestId } });
        return;
      }
      if (!options.enabled) {
        res.locals.interviewOutcome = "unavailable";
        res.status(503).json({ error: { code: "INTERVIEW_REQUESTS_UNAVAILABLE", message: "Interview requests are temporarily unavailable.", requestId: res.locals.interviewRequestId } });
        return;
      }
      if (!req.is("application/json")) {
        res.status(415).json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Request body must be JSON.", requestId: res.locals.interviewRequestId } });
        return;
      }
      next();
    },
    express.json({ limit: "4kb", strict: true, inflate: false }),
    async (req: Request, res: Response) => {
      const parsed = parseInterviewRequest(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: { code: "INVALID_INTERVIEW_REQUEST", message: "Please check the submitted information.", fields: parsed.fields, requestId: res.locals.interviewRequestId } });
        return;
      }
      if (parsed.data.website) {
        res.locals.interviewOutcome = "rejected";
        res.status(400).json({ error: { code: "INVALID_INTERVIEW_REQUEST", message: "Please check the submitted information.", requestId: res.locals.interviewRequestId } });
        return;
      }
      try {
        await options.store(parsed.data);
        res.locals.interviewOutcome = "accepted";
        // Inserts and recognized retries have the same response. Never return
        // row IDs, submitted fields, or whether another row already existed.
        res.status(200).json({ data: { accepted: true } });
      } catch {
        res.locals.interviewOutcome = "failed";
        res.status(500).json({ error: { code: "INTERVIEW_REQUEST_FAILED", message: "Unable to receive your request. Please try again.", requestId: res.locals.interviewRequestId } });
      }
    },
    ((error, _req, res, _next) => {
      const status = (error as { status?: number })?.status;
      const code = status === 413 ? "REQUEST_TOO_LARGE" : status === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "INVALID_REQUEST";
      const message = status === 413 ? "Request body is too large." : status === 415 ? "Request encoding is not supported." : "Request body must be valid JSON.";
      res.status(status === 413 || status === 415 ? status : 400).json({ error: { code, message, requestId: res.locals.interviewRequestId } });
    }) satisfies ErrorRequestHandler,
  );
}
