import type { Express, Request, Response } from 'express';
import type { RequestAuthentication } from '../middleware/tenant-context.js';
import type { AccountLifecycle } from '../services/account-lifecycle.service.js';
import { AccessError } from '../services/practice-policy.js';
import { logFailure } from '../logging.js';

function failure(res: Response, cause: unknown) {
  if (cause instanceof AccessError) {
    res.status(cause.status).json({ error: { code: cause.code, message: cause.message } });
    return;
  }
  logFailure('Personal account operation failed', cause);
  res.status(503).json({
    error: {
      code: 'ACCOUNT_OPERATION_UNAVAILABLE',
      message: 'We couldn’t update your account request. Please try again with the same details.',
    },
  });
}
/** Personal sessions are sufficient; organization roles never identify the account being closed. */
export function registerAccountLifecycleRoutes(
  app: Express,
  lifecycle: AccountLifecycle,
  getAuth: (req: Request) => RequestAuthentication,
) {
  app.get('/api/v1/account', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ data: await lifecycle.state(getAuth(req)) });
    } catch (cause) {
      failure(res, cause);
    }
  });
  app.post('/api/v1/account/archive', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json({ data: await lifecycle.archive(getAuth(req), req.body) });
    } catch (cause) {
      failure(res, cause);
    }
  });
  app.post('/api/v1/account/closure-requests', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.status(202).json({ data: await lifecycle.requestClosure(getAuth(req), req.body) });
    } catch (cause) {
      failure(res, cause);
    }
  });
}
