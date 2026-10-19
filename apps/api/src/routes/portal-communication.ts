import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { RequestAuthentication } from '../middleware/tenant-context.js';
import { portalPrincipal } from '../workflow/paperwork-policy.js';
import { revision, WorkflowError } from '../workflow/policy.js';
import { logFailure } from '../logging.js';
export type PortalCommunicationDependencies = { portalCommunicationPreferences: typeof import('../services/portal-communication.service.js').portalCommunicationPreferences };

export function registerPortalCommunicationRoutes(app: Express, getAuth: (req: Request) => RequestAuthentication, deps: PortalCommunicationDependencies) {
    const path = '/api/v1/patient-paperwork/communication-preferences';
    for (const method of ['get', 'patch'] as const) app[method](path, async (req, res) => {
        const requestId = randomUUID();
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Request-ID', requestId);
        let principal: ReturnType<typeof portalPrincipal> | undefined;
        try {
            principal = portalPrincipal(getAuth(req));
            // Only account-bound bearer requests are accepted; ambient request cookies grant no portal authority.
            if (!/^Bearer [^\s]+$/.test(req.get('Authorization') ?? '')) throw new WorkflowError('UNAUTHENTICATED', 401);
            const data = await deps.portalCommunicationPreferences(principal.subject, principal.sessionId, method === 'patch' ? { input: req.body, revision: revision(req.get('If-Match')), key: req.get('Idempotency-Key') ?? '' } : undefined);
            res.json({ data });
        } catch (error) {
            const status = error instanceof WorkflowError ? error.status : 503;
            const code = error instanceof WorkflowError ? error.code : 'COMMUNICATION_PREFERENCES_UNAVAILABLE';
            if (principal) try { await (await import('../services/patient-paperwork.service.js')).recordPortalPaperworkFailure(principal.subject, principal.sessionId, code, requestId); } catch { logFailure('Portal communication failure audit unavailable', new Error('AUDIT_UNAVAILABLE')); }
            res.status(status).json({ error: { code, message: 'Communication choices could not be updated. Refresh and try again.', requestId, retryable: status >= 500 } });
        }
    });
}
