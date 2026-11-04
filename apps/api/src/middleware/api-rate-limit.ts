import { createHash, randomUUID } from 'node:crypto';
import cors from 'cors';
import { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import type { RequestAuthentication } from './tenant-context.js';

export type ApiRateLimitSettings = {
  windowMs: number;
  global: number;
  perAddress: number;
  perUser: number;
  perUserWrite: number;
};

// Per-process workload protection. Multi-instance deployments need a shared store
// before treating these budgets as fleet-wide quotas. Keep the global limiter
// first: it bounds the number of keys admitted to every subsequent memory store.
export const apiRateLimitDefaults: Readonly<ApiRateLimitSettings> = {
  windowMs: 60_000,
  global: 6_000,
  perAddress: 1_200,
  perUser: 600,
  perUserWrite: 120,
};

export function createApiRateLimitOptions(
  getAuth: (request: Request) => RequestAuthentication,
  origins: string[],
  settings: Partial<ApiRateLimitSettings> = {},
) {
  const limits = { ...apiRateLimitDefaults, ...settings };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error('API rate-limit settings must be positive integers.');
  }
  const responseCors = cors({
    origin: origins,
    credentials: true,
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
    preflightContinue: true,
  });
  const handler: RequestHandler = (req, res, next) => {
    responseCors(req, res, (error) => {
      if (error) {
        next(error);
        return;
      }
      const requestId = randomUUID();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Request-Id', requestId);
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again later.',
          requestId,
          retryable: true,
        },
      });
    });
  };
  const common = {
    windowMs: limits.windowMs,
    standardHeaders: 'draft-8' as const,
    legacyHeaders: false,
    handler,
    // Count rejected, failed and malformed requests, not just successful work.
    passOnStoreError: false,
  };
  const addressKey = (req: Request) =>
    ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown');
  const userKey = (req: Request) => {
    const auth = getAuth(req);
    // The verified user, not a supplied tenant/session/header, owns the budget.
    // Hash identity so limiter storage and standard headers contain no user IDs.
    return createHash('sha256')
      .update(auth.userId ?? addressKey(req))
      .digest('hex');
  };
  const unauthenticated = (req: Request) => {
    const auth = getAuth(req);
    return !auth.isAuthenticated || !auth.userId;
  };
  return {
    process: {
      ...common,
      identifier: 'api-process',
      limit: limits.global,
      keyGenerator: () => 'api',
    },
    address: {
      ...common,
      identifier: 'api-address',
      limit: limits.perAddress,
      keyGenerator: addressKey,
    },
    user: {
      ...common,
      identifier: 'api-user',
      limit: limits.perUser,
      keyGenerator: userKey,
      skip: unauthenticated,
    },
    write: {
      ...common,
      identifier: 'api-user-write',
      limit: limits.perUserWrite,
      keyGenerator: userKey,
      skip: (req: Request) =>
        unauthenticated(req) || ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
    },
  };
}
