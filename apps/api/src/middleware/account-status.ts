import type { Request, RequestHandler } from 'express';
import type { RequestAuthentication } from './tenant-context.js';
import { AccessError } from '../services/practice-policy.js';
import { logFailure } from '../logging.js';

type AccountGate = { assertActive: (auth: RequestAuthentication) => Promise<void> };
/** Check durable personal status even for a cryptographically valid, already-issued token.
 * Status and the idempotent archive retry are the only authenticated recovery paths.
 * Public request-token workflows are registered before this middleware.
 */
export function createAccountStatusMiddleware(
  getAuth: (request: Request) => RequestAuthentication,
  account: AccountGate,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const auth = getAuth(req);
      if (!auth.isAuthenticated || !auth.userId) {
        next();
        return;
      }
      if (
        (req.method === 'GET' && /^\/api\/v1\/account\/?$/.test(req.path)) ||
        (req.method === 'POST' && /^\/api\/v1\/account\/archive\/?$/.test(req.path))
      ) {
        next();
        return;
      }
      await account.assertActive(auth);
      next();
    } catch (cause) {
      if (cause instanceof AccessError) {
        res.status(cause.status).json({ error: { code: cause.code, message: cause.message } });
        return;
      }
      logFailure('Personal account access verification failed', cause);
      res.status(503).json({
        error: {
          code: 'ACCOUNT_OPERATION_UNAVAILABLE',
          message: 'Your account access could not be confirmed. Please try again.',
        },
      });
    }
  };
}
