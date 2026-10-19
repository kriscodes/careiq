import { randomUUID } from 'node:crypto';
import type { Express, Request, RequestHandler, Response, ErrorRequestHandler } from 'express';
import type { RequestAuthentication, TenantContext } from '../middleware/tenant-context.js';
import type { PracticeAccess } from './practice-access.js';
import type * as service from '../services/insurance.service.js';
import { workflowCapabilities } from './workflow.js';
import { body, id, revision, WorkflowError } from '../workflow/policy.js';
import { insuranceRange } from '../workflow/insurance-policy.js';
import { logFailure } from '../logging.js';
export type InsuranceDependencies = typeof service;
export function registerInsuranceRoutes(app: Express, deps: InsuranceDependencies, practiceAccess: PracticeAccess, getAuth: (req: Request) => RequestAuthentication) {
    const base = '/api/v1/locations/:locationId/insurance';
    const requestId = (res: Response): string => { if (!res.locals.insuranceRequestId) res.locals.insuranceRequestId = randomUUID(); res.setHeader('X-Request-Id', res.locals.insuranceRequestId); return res.locals.insuranceRequestId; };
    const fail = async (error: unknown, req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'no-store');
        const known = error as { code?: string; status?: number };
        let status = error instanceof WorkflowError || typeof known.status === 'number' ? known.status! : 500;
        let code = error instanceof WorkflowError || (typeof known.status === 'number' && typeof known.code === 'string') ? known.code! : 'INSURANCE_FAILED';
        if (known.code === '23505') { status = 409; code = 'RESOURCE_CONFLICT'; }
        if (known.code === '23503' || known.code === '23514') { status = 422; code = 'INVALID_RESOURCE_RELATION'; }
        let tenant = res.locals.insuranceTenant as TenantContext | undefined;
        if (!tenant) {
            try { const auth = res.locals.insuranceAuth ?? getAuth(req); if (auth.userId) tenant = { practiceId: '', locationId: '', userId: auth.userId, orgId: auth.orgId ?? '' }; } catch { /* No verified actor is available. */ }
        }
        try { await deps.recordWorkflowFailure(tenant ?? null, { action: 'insurance.request.failed', entityType: 'http_request', requestId: requestId(res), outcome: status === 403 || status === 401 ? 'denied' : status < 500 ? 'rejected' : 'failed', reasonCode: code, metadata: { code, operation: req.method + ' ' + (req.route?.path ?? base) } }); }
        catch (auditError) { logFailure('Insurance failure audit unavailable', auditError); status = 503; code = 'AUDIT_UNAVAILABLE'; }
        if (status >= 500) logFailure('Insurance request unavailable', new Error(code));
        const messages: Record<string, string> = { FORBIDDEN: 'You do not have permission to perform this action.', PRECONDITION_REQUIRED: 'Refresh this case before making changes.', REVISION_CONFLICT: 'This case changed. Refresh it and try again.', ASSIGNEE_UNAVAILABLE: 'Choose an active team member at this location.', PAYER_CONNECTION_UNAVAILABLE: 'Live payer verification is not connected. Record manual evidence instead.', AUDIT_UNAVAILABLE: 'The activity record is unavailable. This action could not be completed.', RESOURCE_CONFLICT: 'This appointment already has an insurance case.', FUTURE_OBSERVATION: 'The observation cannot be in the future.', APPOINTMENT_NOT_ELIGIBLE: 'Choose an upcoming active appointment.', RESOURCE_NOT_FOUND: 'This case or appointment could not be found.' };
        res.status(status).json({ error: { code, message: messages[code] ?? (status >= 500 ? 'Unable to complete the request.' : code.toLowerCase().replaceAll('_', ' ') + '.'), requestId: requestId(res), retryable: status >= 500, ...(error instanceof WorkflowError && error.details ? { details: error.details } : {}) } });
    };
    const authorize: RequestHandler = async (req, res, next) => {
        requestId(res); res.setHeader('Cache-Control', 'no-store');
        try {
            const auth = getAuth(req); res.locals.insuranceAuth = auth;
            const context = await practiceAccess.authorizeLocation(auth, id(req.params.locationId));
            res.locals.insuranceTenant = context.tenant;
            const caps = workflowCapabilities(auth, context.capabilities, context.permissions);
            const read = caps.patientsRead === true && caps.appointmentsRead === true;
            res.locals.insuranceCapabilities = { read, manage: read && caps.workManage === true, evidence: read && caps.workManage === true && caps.documentsReview === true, activity: read && caps.activityRead === true };
            if (!read) throw new WorkflowError('FORBIDDEN', 403);
            next();
        } catch (error) { await fail(error, req, res); }
    };
    const requireCap = (capability: string): RequestHandler => async (req, res, next) => { if (!res.locals.insuranceCapabilities[capability]) { await fail(new WorkflowError('FORBIDDEN', 403), req, res); return; } next(); };
    const wrap = (operation: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => { try { await operation(req, res); } catch (error) { await fail(error, req, res); } };
    const context = (req: Request, res: Response, precondition = false) => ({ requestId: requestId(res), idempotencyKey: req.get('Idempotency-Key'), ...(precondition ? { expectedRevision: revision(req.get('If-Match')) } : {}) });
    const meta = (res: Response) => ({ capabilities: res.locals.insuranceCapabilities, payerConnection: 'unavailable' });
    app.get(base + '/cases', authorize, wrap(async (req, res) => { const result = await deps.listCases(res.locals.insuranceTenant, insuranceRange(req.query), requestId(res)); const { items, pagination, ...context } = result; res.json({ data: items, pagination, meta: { ...context, ...meta(res) } }); }));
    app.get(base + '/manager', authorize, requireCap('manage'), wrap(async (req, res) => { res.json({ data: await deps.managerSummary(res.locals.insuranceTenant, insuranceRange(req.query), requestId(res)), meta: meta(res) }); }));
    app.post(base + '/manager/export', authorize, requireCap('manage'), wrap(async (req, res) => {
        if (Object.keys(req.query).some(key => !['from', 'to'].includes(key))) throw new WorkflowError('INVALID_QUERY');
        body(req.body ?? {}, []);
        res.json({ data: await deps.exportManagerSummary(res.locals.insuranceTenant, insuranceRange(req.query), requestId(res)) });
    }));
    app.get(base + '/assignees', authorize, requireCap('manage'), wrap(async (_req, res) => { res.json({ data: await deps.assignees(res.locals.insuranceTenant, requestId(res)), meta: meta(res) }); }));
    app.get(base + '/cases/:id', authorize, wrap(async (req, res) => { const result = await deps.caseDetail(res.locals.insuranceTenant, id(req.params.id), requestId(res)); res.json({ data: result, meta: meta(res) }); }));
    app.get(base + '/cases/:id/evidence', authorize, wrap(async (req, res) => { const result = await deps.evidenceHistory(res.locals.insuranceTenant, id(req.params.id), deps.historyOptions(req.query), requestId(res)); res.json({ data: result.items, pagination: result.pagination }); }));
    app.get(base + '/cases/:id/activity', authorize, requireCap('activity'), wrap(async (req, res) => { const result = await deps.caseActivity(res.locals.insuranceTenant, id(req.params.id), deps.historyOptions(req.query), requestId(res)); res.json({ data: result.items, pagination: result.pagination }); }));
    app.post(base + '/cases', authorize, requireCap('manage'), wrap(async (req, res) => { res.status(201).json({ data: await deps.createCase(res.locals.insuranceTenant, req.body, context(req, res)) }); }));
    app.post(base + '/cases/:id/evidence', authorize, requireCap('evidence'), wrap(async (req, res) => { res.status(201).json({ data: await deps.addEvidence(res.locals.insuranceTenant, id(req.params.id), req.body, context(req, res, true)) }); }));
    app.post(base + '/cases/:id/follow-up', authorize, requireCap('manage'), wrap(async (req, res) => { res.json({ data: await deps.reviseFollowUp(res.locals.insuranceTenant, id(req.params.id), req.body, context(req, res, true)) }); }));
    app.post(base + '/cases/:id/coverage', authorize, requireCap('manage'), wrap(async (req, res) => { res.json({ data: await deps.reviseCoverage(res.locals.insuranceTenant, id(req.params.id), req.body, context(req, res, true)) }); }));
    app.post(base + '/cases/:id/checks', authorize, requireCap('manage'), wrap(async () => { throw new WorkflowError('PAYER_CONNECTION_UNAVAILABLE', 503); }));
    const parseFailure: ErrorRequestHandler = async (error, req, res, next) => { if (![400, 413, 415].includes((error as { status?: number }).status ?? 0)) { next(error); return; } await fail(new WorkflowError('INVALID_REQUEST', (error as { status: number }).status), req, res); };
    app.use(base, parseFailure);
}
