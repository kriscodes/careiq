import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { registerInsuranceRoutes, type InsuranceDependencies } from '../src/routes/insurance.js';
import type { PracticeAccess } from '../src/routes/practice-access.js';
import type { RequestAuthentication, TenantContext } from '../src/middleware/tenant-context.js';
import { WorkflowError } from '../src/workflow/policy.js';
import type { WorkflowAuditEvent } from '../src/services/workflow-audit.js';

const locationId = randomUUID(), caseId = randomUUID();
const tenant: TenantContext = { practiceId: randomUUID(), locationId, userId: 'user_verified_insurance', orgId: 'org_verified_insurance', membershipId: 'membership_verified_insurance' };
const authenticated: RequestAuthentication = { isAuthenticated: true, userId: tenant.userId, orgId: tenant.orgId, orgRole: 'org:custom' };
type RecordedCall = { operation: string; args: unknown[] };
type CapturedFailure = { tenant: Parameters<InsuranceDependencies['recordWorkflowFailure']>[0]; event: WorkflowAuditEvent };
type Options = {
    permissions?: string[];
    auth?: RequestAuthentication;
    clinicalRead?: boolean;
    authorizeError?: Error;
    auditFailure?: boolean;
    overrides?: Partial<InsuranceDependencies>;
};
async function withInsurance(options: Options, run: (base: string, calls: RecordedCall[], failures: CapturedFailure[]) => Promise<void>) {
    const app = express(), calls: RecordedCall[] = [], failures: CapturedFailure[] = [];
    app.use(express.json({ limit: '8kb' }));
    const store = (operation: string, result: unknown) => async (...args: unknown[]) => { calls.push({ operation, args }); return result; };
    const dependencies = {
        listCases: store('listCases', { items: [], pagination: { hasMore: false, nextCursor: null }, from: '2026-10-18', to: '2026-10-18', timeZone: 'America/Los_Angeles', asOf: '2026-10-18T17:00:00Z', payerConnection: 'unavailable' }),
        managerSummary: store('managerSummary', { summary: { appointments: 0 } }),
        assignees: store('assignees', []),
        caseDetail: store('caseDetail', { case: { id: caseId, concurrency: { ifMatch: '"1"' } }, evidence: [] }),
        evidenceHistory: store('evidenceHistory', { items: [], pagination: { hasMore: false, nextCursor: null } }),
        caseActivity: store('caseActivity', { items: [], pagination: { hasMore: false, nextCursor: null } }),
        createCase: store('createCase', { id: caseId, revision: 1, state: 'unverified' }),
        addEvidence: store('addEvidence', { id: caseId, revision: 2, state: 'active' }),
        reviseFollowUp: store('reviseFollowUp', { id: caseId, revision: 2, state: 'unverified' }),
        reviseCoverage: store('reviseCoverage', { id: caseId, revision: 2, state: 'unverified' }),
        historyOptions: () => ({ limit: 50 }),
        recordWorkflowFailure: async (scope: CapturedFailure['tenant'], event: WorkflowAuditEvent) => {
            failures.push({ tenant: scope, event });
            if (options.auditFailure) throw new Error('AUDIT_WRITER_UNAVAILABLE');
            return randomUUID();
        },
        ...options.overrides,
    } as unknown as InsuranceDependencies;
    const access = { authorizeLocation: async () => {
        if (options.authorizeError) throw options.authorizeError;
        return { tenant, capabilities: { patients: { read: options.clinicalRead !== false }, appointments: { read: options.clinicalRead !== false } }, permissions: options.permissions ?? [] };
    } } as unknown as PracticeAccess;
    registerInsuranceRoutes(app, dependencies, access, () => options.auth ?? authenticated);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/locations/${locationId}/insurance`, calls, failures); }
    finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const post = (url: string, body: unknown = {}, headers: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('insurance read access cannot grant management, evidence review or activity through a forged body', async () => {
    await withInsurance({}, async (base, calls, failures) => {
        const read = await fetch(`${base}/cases?from=2026-10-18&to=2026-10-18`);
        assert.equal(read.status, 200); assert.equal(read.headers.get('Cache-Control'), 'no-store');
        const payload = await read.json();
        assert.deepEqual(payload.meta.capabilities, { read: true, manage: false, evidence: false, activity: false });
        const claimed = { role: 'org:admin', capabilities: { manage: true, evidence: true, activity: true }, actorId: 'forged_actor', practiceId: randomUUID(), memberId: 'PRIVATE_MEMBER_MUST_NOT_BE_AUDITED' };
        for (const path of ['/cases', `/cases/${caseId}/evidence`, `/cases/${caseId}/follow-up`, `/cases/${caseId}/coverage`, `/cases/${caseId}/checks`]) {
            const response = await post(base + path, claimed);
            assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'FORBIDDEN');
        }
        assert.equal((await fetch(`${base}/manager?from=2026-10-18&to=2026-10-18`)).status, 403);
        assert.equal((await fetch(`${base}/cases/${caseId}/activity`)).status, 403);
        assert.deepEqual(calls.map(call => call.operation), ['listCases']);
        assert.equal(failures.length, 7);
        for (const failure of failures) {
            assert.deepEqual(failure.tenant, tenant); assert.equal(failure.event.outcome, 'denied');
            assert.equal(failure.event.reasonCode, 'FORBIDDEN'); assert.equal(failure.event.action, 'insurance.request.failed');
            assert.equal(failure.event.resources, undefined); assert.equal(failure.event.entityId, undefined);
            assert.equal(JSON.stringify(failure).includes(claimed.memberId), false);
            assert.equal(JSON.stringify(failure).includes(claimed.actorId), false);
            assert.equal(JSON.stringify(failure).includes(caseId), false);
        }
    });
});

test('insurance evidence requires both work management and document review while activity remains explicit', async () => {
    for (const permissions of [['org:work:manage'], ['org:documents:review']]) {
        await withInsurance({ permissions }, async (base, calls, failures) => {
            assert.equal((await post(`${base}/cases/${caseId}/evidence`, {}, { 'If-Match': '"1"', 'Idempotency-Key': randomUUID() })).status, 403);
            assert.equal((await fetch(`${base}/cases/${caseId}/activity`)).status, 403);
            assert.equal(calls.length, 0); assert.equal(failures.length, 2);
        });
    }
    await withInsurance({ permissions: ['org:work:manage', 'org:documents:review', 'org:activity:read'] }, async (base, calls) => {
        const key = randomUUID(), input = { source: 'phone', outcome: 'active' };
        const response = await post(`${base}/cases/${caseId}/evidence`, input, { 'If-Match': '"9"', 'Idempotency-Key': key, 'X-Request-Id': 'forged-client-correlation' });
        assert.equal(response.status, 201);
        const call = calls.find(call => call.operation === 'addEvidence')!;
        assert.deepEqual(call.args.slice(0, 3), [tenant, caseId, input]);
        const command = call.args[3] as { requestId: string; expectedRevision: number; idempotencyKey: string };
        assert.equal(command.expectedRevision, 9); assert.equal(command.idempotencyKey, key);
        assert.equal(command.requestId, response.headers.get('X-Request-Id'));
        assert.match(command.requestId, /^[0-9a-f-]{36}$/i); assert.notEqual(command.requestId, 'forged-client-correlation');
        assert.equal((await fetch(`${base}/cases/${caseId}/activity`)).status, 200);
    });
});

test('insurance denial retains a verified user without trusting a requested location or body', async () => {
    await withInsurance({ authorizeError: new WorkflowError('LOCATION_ACCESS_DENIED', 403) }, async (base, calls, failures) => {
        const response = await post(`${base}/cases`, { practiceId: 'claimed_practice', patientId: 'claimed_patient', actorId: 'forged_actor', memberId: 'PRIVATE_MEMBER_DENIED' });
        assert.equal(response.status, 403); assert.equal(calls.length, 0);
        const failure = failures[0]!;
        assert.equal(failure.tenant?.userId, tenant.userId);
        assert.equal(failure.tenant?.practiceId, ''); assert.ok(!failure.tenant?.locationId);
        assert.equal(failure.event.requestId, response.headers.get('X-Request-Id'));
        assert.equal(failure.event.outcome, 'denied');
        assert.equal(JSON.stringify(failure).includes(locationId), false);
        assert.equal(JSON.stringify(failure).includes('PRIVATE_MEMBER_DENIED'), false);
        assert.equal(JSON.stringify(failure).includes('claimed_patient'), false);
    });
    await withInsurance({ auth: { isAuthenticated: false }, authorizeError: new WorkflowError('UNAUTHENTICATED', 401) }, async (base, calls, failures) => {
        const response = await fetch(`${base}/cases`);
        assert.equal(response.status, 401); assert.equal(calls.length, 0);
        assert.equal(failures[0]?.tenant, null); assert.equal(failures[0]?.event.outcome, 'denied');
    });
});

test('insurance capture failure returns unavailable and does not expose domain errors or request contents', async () => {
    await withInsurance({ permissions: ['org:work:manage'], auditFailure: true, overrides: { createCase: async () => { throw new Error('patient_private@example.invalid PRIVATE_MEMBER_DB_ERROR'); } } }, async (base, _calls, failures) => {
        const response = await post(`${base}/cases`, { memberId: 'PRIVATE_MEMBER_BODY' }, { 'Idempotency-Key': randomUUID() });
        assert.equal(response.status, 503); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        const payload = await response.json(); assert.equal(payload.error.code, 'AUDIT_UNAVAILABLE'); assert.equal(payload.error.retryable, true);
        assert.equal(payload.error.requestId, response.headers.get('X-Request-Id'));
        assert.equal(failures[0]?.event.outcome, 'failed'); assert.equal(failures[0]?.event.reasonCode, 'INSURANCE_FAILED');
        assert.equal(JSON.stringify([payload, failures]).includes('PRIVATE_MEMBER'), false);
        assert.equal(JSON.stringify([payload, failures]).includes('patient_private'), false);
    });
});

test('malformed insurance input is independently audited before tenant authorization and marked no-store', async () => {
    await withInsurance({}, async (base, calls, failures) => {
        const response = await fetch(`${base}/cases`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"memberId":"PRIVATE_INVALID_JSON"' });
        assert.equal(response.status, 400); assert.equal(response.headers.get('Cache-Control'), 'no-store');
        const payload = await response.json(); assert.equal(payload.error.code, 'INVALID_REQUEST'); assert.equal(calls.length, 0);
        assert.equal(failures[0]?.event.reasonCode, 'INVALID_REQUEST'); assert.equal(failures[0]?.event.outcome, 'rejected');
        assert.equal(JSON.stringify(failures).includes('PRIVATE_INVALID_JSON'), false);
        assert.equal(failures[0]?.event.requestId, response.headers.get('X-Request-Id'));
    });
});

test('missing case preconditions and unavailable payer attempts produce explicit audit outcomes', async () => {
    await withInsurance({ permissions: ['org:work:manage', 'org:documents:review'] }, async (base, calls, failures) => {
        const response = await post(`${base}/cases/${caseId}/evidence`, {}, { 'Idempotency-Key': randomUUID() });
        assert.equal(response.status, 428); assert.equal((await response.json()).error.code, 'PRECONDITION_REQUIRED');
        assert.equal(failures[0]?.event.outcome, 'rejected'); assert.equal(failures[0]?.event.reasonCode, 'PRECONDITION_REQUIRED');
        const check = await post(`${base}/cases/${caseId}/checks`);
        assert.equal(check.status, 503); assert.equal((await check.json()).error.code, 'PAYER_CONNECTION_UNAVAILABLE');
        assert.equal(failures[1]?.event.outcome, 'failed'); assert.equal(failures[1]?.event.reasonCode, 'PAYER_CONNECTION_UNAVAILABLE');
        assert.equal(calls.length, 0);
    });
});
