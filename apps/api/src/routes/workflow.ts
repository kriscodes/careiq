import express, { type Express, type Request, type Response, type RequestHandler, type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import type { RequestAuthentication, TenantContext } from '../middleware/tenant-context.js';
import type { PracticeAccess } from './practice-access.js';
import type * as service from '../services/workflow.service.js';
import { WorkflowError, id, revision } from '../workflow/policy.js';
import type { WorkflowReadOptions, WorkflowCollection } from '../workflow/read-model.js';
import { maximumFileBytes } from '../workflow/storage.js';
import { logFailure } from '../logging.js';
import { requirePortalBindingAuthority } from '../workflow/paperwork-policy.js';
import { registerPatientPaperworkRoutes } from './patient-paperwork.js';
const staffPortalGrants = async (tenant: TenantContext, patientId: string, requestId: string, cursor?: string) => (await import('../services/portal-admin.service.js')).staffPortalGrants(tenant,patientId,requestId,cursor);
export type WorkflowDependencies = typeof service;
export function workflowCapabilities(auth: RequestAuthentication, clinical?: Record<string, any>, permissions?: string[]): service.WorkflowCapabilities {
    const has = (permission: string) => permissions?.includes(permission) === true;
    return { patientsRead: clinical?.patients?.read === true || has('org:patients:read'), patientsCreate: clinical?.patients?.create === true || has('org:patients:create'), patientsUpdate: has('org:patients:update'), appointmentsRead: clinical?.appointments?.read === true || has('org:appointments:read'), appointmentsCreate: clinical?.appointments?.create === true || has('org:appointments:create'), appointmentsUpdate: has('org:appointments:update'), documentsRead: has('org:documents:read'), documentsUpload: has('org:documents:upload'), documentsReview: has('org:documents:review'), documentsArchive: has('org:documents:archive'), requestsSend: has('org:requests:send'), requirementsWaive: has('org:requirements:waive'), requirementsManage: has('org:requirements:manage'), workManage: has('org:work:manage'), configurationManage: has('org:workflow:configure'), paperworkManage: auth.has?.({permission:'org:paperwork:manage'}) === true && has('org:workflow:configure') && has('org:documents:read'), activityRead: has('org:activity:read') };
}
function requestId(res: Response) {
    if (!res.locals.workflowRequestId)
        res.locals.workflowRequestId = randomUUID();
    res.setHeader('X-Request-Id', res.locals.workflowRequestId);
    return res.locals.workflowRequestId as string;
}
async function fail(error: unknown, req: Request, res: Response, tenant?: TenantContext) {
    const request = requestId(res);
    const known = error as {
        code?: string;
        status?: number;
    };
    let code = error instanceof WorkflowError ? error.code : typeof known.code === 'string' && typeof known.status === 'number' ? known.code : 'WORKFLOW_FAILED', status = error instanceof WorkflowError ? error.status : typeof known.status === 'number' ? known.status : 500;
    const sqlCode = (error as {
        code?: string;
    }).code;
    if (sqlCode === '23P01') {
        code = 'APPOINTMENT_CONFLICT';
        status = 409;
    }
    if (sqlCode === '23505') {
        code = 'RESOURCE_CONFLICT';
        status = 409;
    }
    if (sqlCode === '23503' || sqlCode === '23514') {
        code = 'INVALID_RESOURCE_RELATION';
        status = 422;
    }
    try {
        const { recordWorkflowFailure } = await import('../services/workflow-audit.js');
        await recordWorkflowFailure(tenant ?? null, { action: 'workflow.request.failed', entityType: 'http_request', outcome: status === 403 ? 'denied' : status < 500 ? 'rejected' : 'failed', ...(tenant ? {} : { actorType: 'anonymous' }), reasonCode: code, requestId: request, metadata: { code } });
    }
    catch (auditError) {
        logFailure('Workflow failure audit unavailable', auditError);
    }
    if (status >= 500)
        logFailure('Workflow request failed', new Error(code));
    const message: Record<string, string> = { FORBIDDEN: 'You do not have permission to perform this action.', PRECONDITION_REQUIRED: 'Refresh this record before making changes.', REVISION_CONFLICT: 'This record changed. Refresh and try again.', APPOINTMENT_CONFLICT: 'The provider is unavailable at that time.', OUTSIDE_PROVIDER_AVAILABILITY: 'The selected time is outside provider availability.', SCANNER_UNAVAILABLE: 'Document scanning is unavailable. The file remains quarantined.', PATIENT_LINK_UNAVAILABLE: 'This link is unavailable or has expired.', DELIVERY_PROVIDER_UNAVAILABLE: 'Delivery is not configured. Use the local review link.', RESOURCE_NOT_FOUND: 'The requested record could not be found.' };
    res.status(status).json({ error: { code, message: message[code] ?? (status >= 500 ? 'Unable to complete the request.' : code.toLowerCase().replaceAll('_', ' ') + '.'), requestId: request, retryable: status >= 500, ...(error instanceof WorkflowError && error.details ? { details: error.details } : {}) } });
}
const parseFailure: ErrorRequestHandler = async (error, req, res, next) => {
    const status = (error as {
        status?: number;
    }).status;
    if (status !== 400 && status !== 413 && status !== 415) {
        next(error);
        return;
    }
    await fail(new WorkflowError('INVALID_REQUEST', status), req, res);
};
function readOptions(req: Request, extra: WorkflowReadOptions = {}): WorkflowReadOptions {
    for (const key of ['cursor', 'date', 'limit', 'patientId', 'appointmentId', 'documentId', 'templateId', 'requestId', 'q'])
        if (req.query[key] !== undefined && typeof req.query[key] !== 'string')
            throw new WorkflowError('INVALID_QUERY');
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100))
        throw new WorkflowError('INVALID_PAGINATION');
    return { ...(req.query.cursor ? { cursor: String(req.query.cursor) } : {}), ...(limit ? { limit } : {}), ...(req.query.date ? { date: String(req.query.date) } : {}), ...(req.query.patientId ? { patientId: String(req.query.patientId) } : {}), ...(req.query.appointmentId ? { appointmentId: String(req.query.appointmentId) } : {}), ...(req.query.documentId ? { documentId: String(req.query.documentId) } : {}), ...(req.query.templateId ? { templateId: String(req.query.templateId) } : {}), ...(req.query.requestId ? { requestId: String(req.query.requestId) } : {}), ...(req.query.q ? { search: String(req.query.q) } : {}), ...extra };
}
export function registerWorkflowRoutes(app: Express, deps: WorkflowDependencies, practiceAccess: PracticeAccess, getAuth: (req: Request) => RequestAuthentication, portalAdminRead = staffPortalGrants) {
    const authorize: RequestHandler = async (req, res, next) => {
        try {
            requestId(res);
            const context = await practiceAccess.authorizeLocation(getAuth(req), String(req.params.locationId));
            res.locals.tenant = context.tenant;
            res.locals.workflowCapabilities = workflowCapabilities(getAuth(req), context.capabilities, context.permissions);
            next();
        }
        catch (error) {
            await fail(error, req, res);
        }
    };
    const requireCap = (key: string, alternative?: string): RequestHandler => async (req, res, next) => {
        if (!res.locals.workflowCapabilities[key] && (!alternative || !res.locals.workflowCapabilities[alternative])) {
            await fail(new WorkflowError('FORBIDDEN', 403), req, res, res.locals.tenant);
            return;
        }
        next();
    };
    const base = '/api/v1/locations/:locationId';
    const snapshotRoute: RequestHandler = async (req, res) => {
        try {
            const caps = res.locals.workflowCapabilities;
            if (!caps.patientsRead && !caps.appointmentsRead && !caps.documentsRead && !caps.configurationManage)
                throw new WorkflowError('FORBIDDEN', 403);
            res.json({ data: await deps.snapshot(res.locals.tenant, caps, requestId(res), readOptions(req)) });
        }
        catch (error) {
            await fail(error, req, res, res.locals.tenant);
        }
    };
    app.get([base + '/workflow', base + '/workspace'], authorize, snapshotRoute);
    app.get(base + '/workflow/paperwork/patients/:id/portal-grants', authorize, requireCap('paperworkManage'), async (req,res) => {
        try {
            requirePortalBindingAuthority(getAuth(req));
            if (req.query.cursor !== undefined && typeof req.query.cursor !== 'string') throw new WorkflowError('INVALID_PAPERWORK_CURSOR',400);
            res.json({data:await portalAdminRead(res.locals.tenant,id(req.params.id),requestId(res),req.query.cursor as string | undefined)});
        } catch (error) { await fail(error,req,res,res.locals.tenant); }
    });

    const collections: Record<string, string> = { 'patients': 'patients', 'appointments': 'appointments', 'documents': 'documents', 'templates': 'templates', 'providers': 'providers', 'visit-types': 'visitTypes', 'document-types': 'documentTypes', 'requests': 'requests', 'work-items': 'workItems' };
    for (const [path, key] of Object.entries(collections)) {
        const cap = path === 'patients' ? 'patientsRead' : path === 'appointments' || path === 'work-items' ? 'appointmentsRead' : path === 'providers' || path === 'visit-types' || path === 'document-types' ? 'appointmentsRead' : 'documentsRead';
        app.get(base + '/workflow/' + path, authorize, requireCap(cap, ['templates', 'providers', 'visit-types', 'document-types'].includes(path) ? 'configurationManage' : undefined), async (req, res) => {
            try {
                const result = await deps.snapshot(res.locals.tenant, res.locals.workflowCapabilities, requestId(res), readOptions(req, { collection: key as WorkflowCollection }));
                res.json({ data: (result as any)[key], pagination: result.pagination[key as WorkflowCollection] });
            }
            catch (error) {
                await fail(error, req, res, res.locals.tenant);
            }
        });
        if (['patients', 'appointments', 'documents', 'templates', 'requests'].includes(path))
            app.get(base + '/workflow/' + path + '/:id', authorize, requireCap(cap, ['templates', 'providers', 'visit-types', 'document-types'].includes(path) ? 'configurationManage' : undefined), async (req, res) => {
                try {
                    const entityId = id(req.params.id);
                    const selector = path === 'patients' ? { patientId: entityId } : path === 'appointments' ? { appointmentId: entityId } : path === 'documents' ? { documentId: entityId } : path === 'templates' ? { templateId: entityId } : { requestId: entityId };
                    const result = await deps.snapshot(res.locals.tenant, res.locals.workflowCapabilities, requestId(res), readOptions(req, { ...(path === 'patients' ? {} : { collection: key as WorkflowCollection }), ...selector }));
                    const record = (result as any)[key].find((r: any) => r.id === entityId);
                    if (!record)
                        throw new WorkflowError('RESOURCE_NOT_FOUND', 404);
                    if (path === 'patients')
                        res.json({ data: { ...record, appointments: result.appointments.filter((r: any) => r.patientId === entityId), documents: result.documents.filter((r: any) => r.patientId === entityId), requests: result.requests.filter((r: any) => r.patientId === entityId), pagination: result.pagination, relatedPagination: result.relatedPagination } });
                    else
                        res.json({ data: record });
                }
                catch (error) {
                    await fail(error, req, res, res.locals.tenant);
                }
            });
    }
    app.get(base + '/workflow/today', authorize, requireCap('appointmentsRead'), async (req, res) => {
        try {
            const date = typeof req.query.date === 'string' ? req.query.date : await deps.locationDate(res.locals.tenant);
            const result = await deps.snapshot(res.locals.tenant, res.locals.workflowCapabilities, requestId(res), readOptions(req, { date }));
            res.json({ data: { locationId: req.params.locationId, date, timeZone: result.timeZone, asOf: result.asOf, summary: result.summary, appointments: { items: result.appointments, pagination: result.pagination.appointments }, workItems: { items: result.workItems, pagination: result.pagination.workItems } } });
        }
        catch (error) {
            await fail(error, req, res, res.locals.tenant);
        }
    });
    for (const [resource, collection, selector] of [['documents', 'documentVersions', 'documentId'], ['templates', 'templateVersions', 'templateId']] as const)
        app.get(base + '/workflow/' + resource + '/:id/versions', authorize, requireCap('documentsRead', resource === 'templates' ? 'configurationManage' : undefined), async (req, res) => {
            try {
                const result = await deps.snapshot(res.locals.tenant, res.locals.workflowCapabilities, requestId(res), readOptions(req, { collection, [selector]: id(req.params.id) }));
                res.json({ data: result[collection], pagination: result.pagination[collection] });
            }
            catch (error) {
                await fail(error, req, res, res.locals.tenant);
            }
        });
    app.get(base + '/workflow/providers/:id/availability', authorize, requireCap('appointmentsRead', 'configurationManage'), async (req, res) => {
        try {
            res.json({ data: await deps.providerAvailability(res.locals.tenant, String(req.params.id), requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res, res.locals.tenant);
        }
    });
    for (const resource of ['patients', 'appointments', 'documents', 'templates'])
        app.get(base + '/workflow/' + resource + '/:id/edit-state', authorize, requireCap(resource === 'patients' ? 'patientsRead' : resource === 'appointments' ? 'appointmentsRead' : 'documentsRead', resource === 'templates' ? 'configurationManage' : undefined), async (req, res) => {
            try {
                const result = await deps.editState(res.locals.tenant, resource, String(req.params.id), requestId(res));
                res.setHeader('ETag', result.concurrency.ifMatch);
                res.json({ data: result });
            }
            catch (error) {
                await fail(error, req, res, res.locals.tenant);
            }
        });
    app.get(base + '/workflow/activity', authorize, requireCap('activityRead'), async (req, res) => {
        try {
            res.json({ data: await deps.activity(res.locals.tenant, req.query, requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res, res.locals.tenant);
        }
    });
    app.get(base + '/workflow/operations/:id', authorize, requireCap('documentsRead'), async (req, res) => {
        try {
            res.json({ data: await deps.operation(res.locals.tenant, String(req.params.id), requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res, res.locals.tenant);
        }
    });
    const commands: Array<[
        string,
        string,
        string,
        string,
        boolean?
    ]> = [
        ['post', 'patients', 'patients.create', 'patientsCreate'], ['patch', 'patients/:id', 'patients.update', 'patientsUpdate', true], ['post', 'appointments', 'appointments.create', 'appointmentsCreate'], ['patch', 'appointments/:id', 'appointments.update', 'appointmentsUpdate', true], ['post', 'appointments/:id/status', 'appointments.status', 'appointmentsUpdate', true], ['post', 'appointments/:id/status-transitions', 'appointments.status', 'appointmentsUpdate', true], ['post', 'appointments/:id/cancellation', 'appointments.cancellation', 'appointmentsUpdate', true], ['post', 'appointments/:id/cancellations', 'appointments.cancellation', 'appointmentsUpdate', true], ['post', 'appointments/:id/requirements/reconciliation', 'requirements.reconciliation', 'requirementsManage', true], ['post', 'requirements/:id/waiver', 'requirements.waiver', 'requirementsWaive', true], ['post', 'requirements/:id/waiver-revocation', 'requirements.waiver-revocation', 'requirementsWaive', true], ['post', 'requirements/:id/evidence', 'requirements.evidence', 'documentsReview', true], ['post', 'providers', 'providers.create', 'configurationManage'], ['patch', 'providers/:id', 'providers.update', 'configurationManage', true], ['post', 'providers/:id/availability', 'providers.availability', 'configurationManage', true], ['post', 'providers/:id/assignment', 'providers.assignment', 'configurationManage', true], ['post', 'visit-types', 'visit-types.create', 'configurationManage'], ['post', 'document-types', 'document-types.create', 'configurationManage'], ['post', 'requirement-rule-sets/publication', 'rules.publication', 'configurationManage'], ['post', 'documents/:id/current-version', 'documents.current-version', 'documentsUpload', true], ['post', 'documents/:id/archive', 'documents.archive', 'documentsArchive', true], ['post', 'documents/:id/restore', 'documents.restore', 'documentsArchive', true], ['post', 'document-versions/:id/reviews', 'documents.review', 'documentsReview'], ['post', 'templates', 'templates.create', 'configurationManage'], ['patch', 'templates/:id', 'templates.update', 'configurationManage', true], ['post', 'templates/:id/versions', 'templates.versions', 'configurationManage', true], ['patch', 'template-versions/:id', 'templates.version-update', 'configurationManage', true], ['post', 'template-versions/:id/validation', 'templates.validation', 'configurationManage', true], ['post', 'templates/:id/publication', 'templates.publication', 'configurationManage', true], ['post', 'templates/:id/versions/:versionId/publication', 'templates.publication', 'configurationManage', true], ['post', 'templates/:id/preparations', 'templates.preparation', 'documentsUpload'], ['post', 'patients/:id/prepared-documents', 'templates.preparation', 'documentsUpload'], ['post', 'patients/:id/uploads', 'uploads.reservation', 'documentsUpload'], ['post', 'patients/:id/document-uploads', 'uploads.reservation', 'documentsUpload'], ['post', 'upload-sessions/:id/completion', 'uploads.completion', 'documentsUpload'], ['post', 'uploads/:id/completion', 'uploads.completion', 'documentsUpload'], ['post', 'requests', 'requests.create', 'requestsSend'], ['post', 'patients/:id/document-requests', 'requests.create', 'requestsSend'], ['post', 'requests/:id/reminders', 'requests.reminders', 'requestsSend', true], ['post', 'requests/:id/reissue', 'requests.reissue', 'requestsSend', true], ['post', 'requests/:id/reissues', 'requests.reissue', 'requestsSend', true], ['post', 'requests/:id/cancellation', 'requests.cancellation', 'requestsSend', true], ['post', 'work-items/:id/assignment', 'work-items.assignment', 'workManage', true], ['post', 'work-items/:id/completion', 'work-items.completion', 'workManage', true],
        ['post','paperwork/requests','paperwork.requests.create','requestsSend'], ['post','paperwork/patients/:id/portal-grants','paperwork.portal.bind','configurationManage'], ['post','paperwork/portal-grants/:id/revocation','paperwork.portal.revoke','configurationManage',true], ['post','paperwork/notifications/:id/retry','paperwork.notifications.retry','requestsSend',true], ['patch','paperwork/library-items/:id/release','paperwork.library.release','documentsArchive',true],
    ];
    for (const [method, path, action, cap, precondition] of commands) {
        (app as any)[method](base + '/workflow/' + path, authorize, requireCap(cap), async (req: Request, res: Response) => {
            try {
                if (['paperwork.portal.bind','paperwork.portal.revoke'].includes(action)) { if (!res.locals.workflowCapabilities.documentsRead) throw new WorkflowError('FORBIDDEN',403); requirePortalBindingAuthority(getAuth(req)); }
                const expectedRevision = precondition ? revision(req.get('If-Match')) : undefined;
                const payload = req.params.versionId ? { ...req.body, versionId: req.params.versionId } : req.body;
                const result = await deps.execute(res.locals.tenant, action, req.params.id ? String(req.params.id) : '', payload, { requestId: requestId(res), idempotencyKey: req.get('Idempotency-Key'), expectedRevision });
                res.status(action.endsWith('.create') || action === 'uploads.reservation' ? 201 : 200).json({ data: result });
            }
            catch (error) {
                await fail(error, req, res, res.locals.tenant);
            }
        });
    }
    app.put([base + '/workflow/upload-sessions/:id/content', base + '/workflow/uploads/:id/content'], authorize, requireCap('documentsUpload'), express.raw({ type: () => true, limit: maximumFileBytes, inflate: false }), async (req, res) => {
        try {
            if (!Buffer.isBuffer(req.body))
                throw new WorkflowError('BINARY_BODY_REQUIRED');
            res.json({ data: await deps.putUpload(res.locals.tenant, String(req.params.id), req.body, requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res, res.locals.tenant);
        }
    });
    app.get([base + '/workflow/document-versions/:id/content', base + '/workflow/document-versions/:id/access'], authorize, requireCap('documentsRead'), async (req, res) => {
        try {
            const purpose = req.query.purpose === 'download' ? 'download' : req.query.purpose === 'print' ? 'print' : 'view';
            const transferRequestId = requestId(res);
            const result = await deps.documentContent(res.locals.tenant, String(req.params.id), transferRequestId, purpose);
            let completed = false;
            res.on('finish', () => { completed = true; void deps.observeContent(res.locals.tenant, result, result.bytes.length, true, transferRequestId).catch(e => logFailure('Transfer evidence failed', e)); });
            res.on('close', () => {
                if (!completed)
                    void deps.observeContent(res.locals.tenant, result, 0, false, transferRequestId).catch(e => logFailure('Transfer evidence failed', e));
            });
            res.setHeader('Content-Type', result.contentType);
            res.setHeader('Content-Disposition', `${purpose === 'download' ? 'attachment' : 'inline'}; filename="${result.filename.replace(/[^a-zA-Z0-9._ -]/g, '_')}"`);
            res.send(result.bytes);
        }
        catch (error) {
            await fail(error, req, res, res.locals.tenant);
        }
    });
    app.get(base + '/workflow/paperwork/patients/:id',authorize,requireCap('documentsRead'),async(req,res)=>{
        try{for(const key of ['libraryCursor','notificationCursor'])if(req.query[key]!==undefined&&typeof req.query[key]!=='string')throw new WorkflowError('INVALID_PAPERWORK_CURSOR',400);res.json({data:await (await import('../services/patient-paperwork.service.js')).staffPaperwork(res.locals.tenant,String(req.params.id),requestId(res),{libraryCursor:req.query.libraryCursor as string|undefined,notificationCursor:req.query.notificationCursor as string|undefined})});}catch(error){await fail(error,req,res,res.locals.tenant);}
    });
    app.get(base + '/workflow/patients/:id/form-changes',authorize,requireCap('documentsReview'),requireCap('patientsRead'),async(req,res)=>{
        try{if(req.query.cursor!==undefined&&typeof req.query.cursor!=='string')throw new WorkflowError('INVALID_FORM_CHANGE_CURSOR',400);res.json({data:await (await import('../services/form-changes.service.js')).formChanges(res.locals.tenant,String(req.params.id),requestId(res),req.query.cursor as string|undefined)});}catch(error){await fail(error,req,res,res.locals.tenant);}
    });
    app.post(base + '/workflow/form-changes/:id/decisions',authorize,requireCap('documentsReview'),requireCap('patientsUpdate'),async(req,res)=>{
        try{res.json({data:await deps.execute(res.locals.tenant,'form-changes.decisions',String(req.params.id),req.body,{requestId:requestId(res),idempotencyKey:req.get('Idempotency-Key'),expectedRevision:revision(req.get('If-Match'))})});}catch(error){await fail(error,req,res,res.locals.tenant);}
    });
    app.post(base + '/workflow/template-versions/:id/preview', authorize, requireCap('configurationManage'), async (req,res) => {
        try {const result=await deps.templatePreview(res.locals.tenant,String(req.params.id),req.body,revision(req.get('If-Match')),requestId(res));res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',result.contentType);res.setHeader('Content-Disposition','inline; filename="template-preview.pdf"');res.send(result.bytes);}
        catch(error){await fail(error,req,res,res.locals.tenant);}
    });
    app.use(base + '/workflow', parseFailure);
}
export function registerPatientWorkflowRoutes(app: Express, deps: WorkflowDependencies, origins: string[]) {
    const base = '/api/v1/patient-workflows';
    const attempts = new Map<string, {
        count: number;
        until: number;
    }>();
    app.use(base, cors({ origin: origins, credentials: true }), express.json({ limit: '256kb', inflate: false }), (req, res, next) => {
        requestId(res);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (req.get('Origin') && !origins.includes(req.get('Origin')!)) {
            void fail(new WorkflowError('ORIGIN_DENIED', 403), req, res);
            return;
        }
        const key = req.ip ?? 'unknown', current = attempts.get(key), time = Date.now();
        if (attempts.size > 10000)
            for (const [k, v] of attempts)
                if (v.until < time)
                    attempts.delete(k);
        if (!current || current.until < time)
            attempts.set(key, { count: 1, until: time + 60000 });
        else if (++current.count > 60) {
            res.setHeader('Retry-After', '60');
            void fail(new WorkflowError('RATE_LIMITED', 429), req, res);
            return;
        }
        next();
    });
    const token = (req: Request) => {
        const raw = req.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('careiq_patient_session='))?.slice('careiq_patient_session='.length);
        if (!raw)
            throw new WorkflowError('PATIENT_LINK_UNAVAILABLE', 410);
        return raw;
    };
    registerPatientPaperworkRoutes(app,{base,token,requestId,fail});
    app.post(base + '/session-exchanges', async (req, res) => {
        try {
            const result = await deps.exchangePatientSession(req.body, requestId(res));
            res.cookie('careiq_patient_session', result.sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: base, maxAge: 60 * 60000 });
            res.json({ data: { requestId: result.requestId, expiresAt: result.expiresAt } });
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.get([base + '/request', base + '/session'], async (req, res) => {
        try {
            res.json({ data: await deps.patientRequest(token(req), requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.get(base + '/document', async (req, res) => {
        try {
            const result = await deps.patientDocument(token(req), requestId(res));
            res.setHeader('Content-Type', result.contentType);
            res.setHeader('Content-Disposition', 'inline');
            res.send(result.bytes);
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.post(base + '/completion', async (req, res) => {
        try {
            res.json({ data: await deps.patientCompletion(token(req), req.body, req.get('Idempotency-Key') ?? '', requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.post(base + '/uploads', async (req, res) => {
        try {
            res.status(201).json({ data: await deps.patientUploadReservation(token(req), req.body, req.get('Idempotency-Key') ?? '', requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.put(base + '/uploads/:id/content', express.raw({ type: () => true, limit: maximumFileBytes, inflate: false }), async (req, res) => {
        try {
            if (!Buffer.isBuffer(req.body))
                throw new WorkflowError('BINARY_BODY_REQUIRED');
            res.json({ data: await deps.patientUploadContent(token(req), String(req.params.id), req.body, requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.post(base + '/uploads/:id/completion', async (req, res) => {
        try {
            res.json({ data: await deps.patientUploadCompletion(token(req), String(req.params.id), req.body, req.get('Idempotency-Key') ?? '', requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.post(base + '/decline', async (req, res) => {
        try {
            res.json({ data: await deps.patientDecline(token(req), req.body, req.get('Idempotency-Key') ?? '', requestId(res)) });
        }
        catch (error) {
            await fail(error, req, res);
        }
    });
    app.use(base, parseFailure);
}
