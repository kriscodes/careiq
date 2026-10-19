import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import { insuranceRange } from '../src/workflow/insurance-policy.js';
import { WorkflowError } from '../src/workflow/policy.js';
const url = isolatedTestDatabaseUrl();
test('insurance manual workflow is durable, scoped, retry safe and inseparable from protected audit', { skip: !url }, async context => {
    const admin = new Pool({ connectionString: url, ssl: false });
    const suffix = randomBytes(6).toString('hex'), role = 'careiq_insurance_test_' + suffix, password = randomBytes(24).toString('hex');
    const practiceId = randomUUID(), locationId = randomUUID(), otherLocationId = randomUUID(), patientId = randomUUID(), otherPatientId = randomUUID();
    const userId = 'synthetic_insurance_' + suffix, membershipId = 'membership_' + suffix, inactiveId = 'synthetic_inactive_' + suffix;
    const tenant = { practiceId, locationId, userId, membershipId, orgId: 'org_' + practiceId };
    const appointments = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const otherAppointmentId = randomUUID(), otherCaseId = randomUUID();
    const old = { url: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL_MODE };
    let runtimePool: Pool | undefined, caseId = '', secondCaseId = '', thirdCaseId = '', firstEvidenceId = '', correctionId = '';
    const ctx = (expectedRevision?: number) => ({ requestId: randomUUID(), idempotencyKey: randomUUID(), expectedRevision });
    const sensitive = { payerName: 'Private synthetic payer ' + suffix, memberId: 'PRIVATE-MEMBER-' + suffix, reference: 'Private synthetic reference ' + suffix };
    try {
        await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
        await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
        await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic insurance','location','active')", [practiceId, tenant.orgId]);
        await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic A','America/Los_Angeles'),($2,$3,'Synthetic B','America/Los_Angeles')", [locationId, otherLocationId, practiceId]);
        await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active'),($1,$4,$5,'suspended')", [practiceId, userId, membershipId, inactiveId, 'inactive_membership_' + suffix]);
        await admin.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2),($1,$4,$3,true,$2)', [practiceId, userId, locationId, inactiveId]);
        await admin.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$3,$4,'Private synthetic','Patient'),($2,$3,$5,'Hidden synthetic','Patient')", [patientId, otherPatientId, practiceId, locationId, otherLocationId]);
        for (let i = 0; i < appointments.length; i++) await admin.query('INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at) VALUES($1,$2,$3,$4,$5)', [appointments[i], practiceId, locationId, patientId, ['2027-01-04T17:00:00.123001Z', '2027-01-04T17:00:00.123002Z', '2027-01-04T17:00:00.123003Z', '2027-01-04T18:00:00Z'][i]]);
        await admin.query('INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at) VALUES($1,$2,$3,$4,$5)', [otherAppointmentId, practiceId, otherLocationId, otherPatientId, '2027-01-04T18:00:00Z']);
        await admin.query('INSERT INTO insurance_cases(id,practice_id,location_id,patient_id,appointment_id,payer_name,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [otherCaseId, practiceId, otherLocationId, otherPatientId, otherAppointmentId, 'Hidden payer', userId]);
        const runtimeUrl = new URL(url!); runtimeUrl.username = role; runtimeUrl.password = password;
        process.env.DATABASE_URL = runtimeUrl.href; process.env.DATABASE_SSL_MODE = 'disable';
        const service = await import('../src/services/insurance.service.js');
        ({ pool: runtimePool } = await import('../src/db/client.js'));
        const range = insuranceRange({ from: '2027-01-04', to: '2027-01-04' });
        await context.test('creation validates actual appointments and recipients and replays the identical receipt', async () => {
            const input = { appointmentId: appointments[0], payerName: sensitive.payerName, memberId: sensitive.memberId, assigneeUserId: userId, dueAt: '2026-01-01T12:00:00Z' }, command = ctx();
            const result = await service.createCase(tenant, input, command); caseId = result.id;
            assert.deepEqual(await service.createCase(tenant, input, { ...command, requestId: randomUUID() }), result);
            await assert.rejects(service.createCase(tenant, { ...input, payerName: 'Changed' }, command), error => error instanceof WorkflowError && error.code === 'IDEMPOTENCY_KEY_REUSED');
            await assert.rejects(service.createCase(tenant, { appointmentId: appointments[3], payerName: 'Synthetic', assigneeUserId: inactiveId }, ctx()), error => error instanceof WorkflowError && error.code === 'ASSIGNEE_UNAVAILABLE');
            await assert.rejects(service.createCase(tenant, { appointmentId: otherAppointmentId, payerName: 'Synthetic' }, ctx()), error => error instanceof WorkflowError && error.status === 404);
            assert.equal((await admin.query('SELECT id FROM insurance_cases WHERE practice_id=$1 AND location_id=$2', [practiceId, locationId])).rowCount, 1);
            const retry = (await admin.query('SELECT response FROM workflow_request_keys WHERE practice_id=$1 AND request_key=$2', [practiceId, command.idempotencyKey])).rows[0].response;
            assert.deepEqual(retry, result); assert.equal(JSON.stringify(retry).includes(sensitive.memberId), false);
            assert.equal((await admin.query("SELECT id FROM audit.events WHERE practice_id=$1 AND action='insurance.case.created'", [practiceId])).rowCount, 1);
            assert.equal((await admin.query("SELECT id FROM audit.events WHERE practice_id=$1 AND action='insurance.cases.create.replay'", [practiceId])).rowCount, 1);
        });
        await context.test('evidence keeps unknown amounts distinct from zero and supports immutable corrections', async () => {
            const input = { source: 'phone', observedAt: new Date(Date.now() - 60000).toISOString(), reference: sensitive.reference, outcome: 'active', copayCents: 0, reasonCode: 'manual_verification' }, command = ctx(1);
            const result = await service.addEvidence(tenant, caseId, input, command); firstEvidenceId = result.evidenceId;
            assert.deepEqual(await service.addEvidence(tenant, caseId, input, { ...command, requestId: randomUUID() }), result);
            await assert.rejects(service.addEvidence(tenant, caseId, input, ctx(1)), error => error instanceof WorkflowError && error.code === 'REVISION_CONFLICT');
            const detail = await service.caseDetail(tenant, caseId, randomUUID());
            assert.equal(detail.case.memberId, undefined); assert.equal(detail.case.memberIdMasked, '••••' + sensitive.memberId.slice(-4));
            assert.equal(detail.evidence[0].copayCents, 0); assert.equal(detail.evidence[0].deductibleRemainingCents, null);
            assert.equal(detail.evidence[0].payerNameSnapshot, sensitive.payerName); assert.equal(detail.evidence[0].memberIdSnapshot, undefined);
            assert.equal(detail.case.currentEvidenceId, firstEvidenceId);
            await service.reviseFollowUp(tenant, caseId, { assigneeUserId: userId, dueAt: null, reasonCode: 'follow_up' }, ctx(2));
            await assert.rejects(service.reviseFollowUp(tenant, caseId, { assigneeUserId: inactiveId, dueAt: null, reasonCode: 'assignment' }, ctx(3)), error => error instanceof WorkflowError && error.code === 'ASSIGNEE_UNAVAILABLE');
            const corrected = await service.addEvidence(tenant, caseId, { ...input, copayCents: null, outcome: 'inactive', supersedesEvidenceId: firstEvidenceId, reasonCode: 'correction' }, ctx(3)); correctionId = corrected.evidenceId;
            await assert.rejects(service.addEvidence(tenant, caseId, { ...input, supersedesEvidenceId: firstEvidenceId, reasonCode: 'correction' }, ctx(4)), error => error instanceof WorkflowError && error.code === 'EVIDENCE_NOT_CURRENT');
            await assert.rejects(admin.query('UPDATE insurance_evidence SET outcome=$2 WHERE id=$1', [firstEvidenceId, 'inactive']), error => (error as { code?: string }).code === '23514');
            assert.equal((await admin.query('SELECT outcome FROM insurance_evidence WHERE id=$1', [firstEvidenceId])).rows[0].outcome, 'active');
            assert.equal((await admin.query('SELECT supersedes_evidence_id FROM insurance_evidence WHERE id=$1', [correctionId])).rows[0].supersedes_evidence_id, firstEvidenceId);
        });
        await context.test('policy correction invalidates the selected result while preserving the observed policy', async () => {
            await service.reviseCoverage(tenant, caseId, { payerName: 'Corrected synthetic payer', memberId: 'CORRECTED-' + suffix, reasonCode: 'correction' }, ctx(4));
            const reset = await service.caseDetail(tenant, caseId, randomUUID());
            assert.equal(reset.case.state, 'unverified'); assert.equal(reset.case.currentEvidenceId, null); assert.equal(reset.evidence.length, 2);
            assert.equal(reset.evidence[0].payerNameSnapshot, sensitive.payerName);
            await service.addEvidence(tenant, caseId, { source: 'payer_portal', observedAt: new Date(Date.now() - 60000).toISOString(), reference: 'Corrected policy reference', outcome: 'active', reasonCode: 'manual_verification' }, ctx(5));
            assert.equal((await service.caseDetail(tenant, caseId, randomUUID())).evidence[0].payerNameSnapshot, 'Corrected synthetic payer');
        });
        await context.test('manager counts, clinical reads and workload use only selected location and bounded local dates', async () => {
            secondCaseId = (await service.createCase(tenant, { appointmentId: appointments[1], payerName: 'Synthetic payer B' }, ctx())).id;
            thirdCaseId = (await service.createCase(tenant, { appointmentId: appointments[2], payerName: 'Synthetic payer C', dueAt: '2026-01-01T12:00:00Z' }, ctx())).id;
            const dashboard = await service.managerSummary(tenant, range, randomUUID());
            assert.deepEqual(dashboard.summary, { appointments: 4, tracked: 3, untracked: 1, unverified: 2, active: 1, inactive: 0, needsFollowUp: 0, overdue: 1, unassigned: 2, stale: 0 });
            assert.equal(dashboard.timeZone, 'America/Los_Angeles'); assert.equal(dashboard.payerConnection, 'unavailable');
            assert.deepEqual(dashboard.team, [{ userId: null, openCases: 2, overdueCases: 1 }]);
            assert.deepEqual((await service.assignees(tenant, randomUUID())).map((member: { userId: string }) => member.userId), [userId]);
            await assert.rejects(service.caseDetail(tenant, otherCaseId, randomUUID()), error => error instanceof WorkflowError && error.status === 404);
            await assert.rejects(service.listCases({ ...tenant, locationId: otherLocationId }, range, randomUUID()), error => error instanceof WorkflowError && error.status === 403);
            assert.equal((await service.managerSummary(tenant, insuranceRange({ from: '2027-01-03', to: '2027-01-03' }), randomUUID())).summary.appointments, 0);
        });
        await context.test('manager export releases only bounded aggregate counts after an authorization audit', async () => {
            const requestId = randomUUID(), exported = await service.exportManagerSummary(tenant, range, requestId);
            assert.deepEqual(Object.keys(exported).sort(), ['asOf', 'from', 'summary', 'timeZone', 'to']);
            assert.equal(exported.summary.appointments, 4); assert.equal(exported.summary.tracked, 3);
            const encoded = JSON.stringify(exported);
            for (const value of [patientId, userId, caseId, sensitive.payerName, sensitive.memberId, sensitive.reference]) assert.equal(encoded.includes(value), false);
            const event = (await admin.query("SELECT action,metadata FROM audit.events WHERE practice_id=$1 AND request_id=$2", [practiceId, requestId])).rows;
            assert.equal(event.length, 1); assert.equal(event[0].action, 'manager.summary.export_authorized');
            assert.equal(event[0].metadata.purpose, 'service_dates:2027-01-04/2027-01-04');
        });
        await context.test('seek cursors keep rows within the same timestamp millisecond without skipping', async () => {
            const seen: string[] = []; let cursor: string | null = null;
            do {
                const result = await service.listCases(tenant, insuranceRange({ from: range.from, to: range.to, limit: '1', ...(cursor ? { cursor } : {}) }), randomUUID());
                seen.push(...result.items.map(item => item.id)); cursor = result.pagination.nextCursor;
            } while (cursor);
            assert.deepEqual(seen, [caseId, secondCaseId, thirdCaseId]);
            const bound = await service.listCases(tenant, insuranceRange({ from: range.from, to: range.to, limit: '1' }), randomUUID());
            await assert.rejects(service.listCases(tenant, insuranceRange({ from: range.from, to: range.to, limit: '2', cursor: bound.pagination.nextCursor }), randomUUID()), error => error instanceof WorkflowError && error.code === 'INVALID_CURSOR');
            const eventId = (await admin.query("SELECT id FROM audit.events WHERE practice_id=$1 AND action='insurance.case.created' AND entity_id=$2", [practiceId, secondCaseId])).rows[0].id;
            const historicalIds = [randomUUID(), randomUUID()];
            for (let i = 0; i < 2; i++) await admin.query("INSERT INTO insurance_evidence(id,practice_id,location_id,patient_id,appointment_id,case_id,payer_name_snapshot,source,observed_at,reference,outcome,reason_code,created_by_actor_id,audit_event_id,created_at,scheduled_at_snapshot) VALUES($1,$2,$3,$4,$5,$6,'Synthetic payer B','phone','2026-01-01T12:00:00Z','Synthetic historical evidence','needs_follow_up','manual_verification',$7,$8,$9,'2027-01-04T17:00:00.123002Z')", [historicalIds[i], practiceId, locationId, patientId, appointments[1], secondCaseId, userId, eventId, `2026-01-01T12:00:00.33300${i + 1}Z`]);
            const first = await service.evidenceHistory(tenant, secondCaseId, service.historyOptions({ limit: '1' }), randomUUID());
            const second = await service.evidenceHistory(tenant, secondCaseId, service.historyOptions({ limit: '1', cursor: first.pagination.nextCursor }), randomUUID());
            assert.equal(first.items[0].id, historicalIds[1]); assert.equal(second.items[0].id, historicalIds[0]);
            assert.equal(second.pagination.hasMore, false);
            await assert.rejects(service.evidenceHistory(tenant, thirdCaseId, service.historyOptions({ limit: '1', cursor: first.pagination.nextCursor }), randomUUID()), error => error instanceof WorkflowError && error.code === 'INVALID_CURSOR');
        });
        await context.test('activity projects safe case actions with patient relationships and audits access', async () => {
            const result = await service.caseActivity(tenant, caseId, { limit: 100 }, randomUUID());
            for (const action of ['insurance.case.created', 'insurance.evidence.recorded', 'insurance.evidence.corrected', 'insurance.follow_up.revised', 'insurance.coverage.revised']) assert.ok(result.items.some((item: { action: string }) => item.action === action));
            assert.equal(result.items.some((item: { action: string }) => item.action.endsWith('.replay')), false);
            assert.equal(result.items.some((item: { entityId: string }) => item.entityId === otherCaseId), false);
            const event = (await admin.query("SELECT id FROM audit.events WHERE practice_id=$1 AND action='insurance.evidence.corrected'", [practiceId])).rows[0];
            const relations = (await admin.query('SELECT resource_type,patient_id FROM audit.event_resources WHERE event_id=$1', [event.id])).rows;
            for (const type of ['insurance_case', 'patient', 'appointment', 'insurance_evidence']) assert.ok(relations.some(row => row.resource_type === type && row.patient_id === patientId));
            const audits = (await admin.query('SELECT metadata,authorization_context FROM audit.events WHERE practice_id=$1', [practiceId])).rows;
            const rowEvidence = (await admin.query("SELECT before_evidence,after_evidence,changed_fields FROM audit.database_records WHERE practice_id=$1 AND table_name IN ('insurance_cases','insurance_evidence')", [practiceId])).rows;
            const serialized = JSON.stringify([audits, rowEvidence, result.items]);
            for (const value of Object.values(sensitive)) assert.equal(serialized.includes(value), false);
            assert.ok(rowEvidence.some(row => row.changed_fields.includes('reference')));
            assert.ok((await admin.query("SELECT id FROM audit.events WHERE practice_id=$1 AND action='insurance.activity.read'", [practiceId])).rowCount);
        });
        await context.test('audit writer failure rolls back business data and retries; post-rollback failure evidence survives', async () => {
            const trigger = 'synthetic_insurance_audit_' + suffix;
            await admin.query(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.practice_id='${practiceId}'::uuid AND NEW.action IN ('insurance.evidence.recorded','insurance.case.read') THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_UNAVAILABLE'; END IF; RETURN NEW; END $$`);
            await admin.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`);
            const command = ctx(6), before = (await admin.query('SELECT count(*)::integer AS count FROM insurance_evidence WHERE case_id=$1', [caseId])).rows[0].count;
            try {
                await assert.rejects(service.addEvidence(tenant, caseId, { source: 'phone', observedAt: new Date(Date.now() - 60000).toISOString(), reference: 'Should roll back', outcome: 'inactive', reasonCode: 'manual_verification' }, command));
                await assert.rejects(service.caseDetail(tenant, caseId, randomUUID()));
                assert.equal((await admin.query('SELECT revision FROM insurance_cases WHERE id=$1', [caseId])).rows[0].revision, '6');
                assert.equal((await admin.query('SELECT count(*)::integer AS count FROM insurance_evidence WHERE case_id=$1', [caseId])).rows[0].count, before);
                assert.equal((await admin.query('SELECT id FROM workflow_request_keys WHERE practice_id=$1 AND request_key=$2', [practiceId, command.idempotencyKey])).rowCount, 0);
                await service.recordWorkflowFailure(tenant, { action: 'insurance.request.failed', entityType: 'http_request', outcome: 'failed', reasonCode: 'SYNTHETIC_AUDIT_FAILURE', requestId: command.requestId });
                assert.equal((await admin.query("SELECT id FROM audit.events WHERE request_id=$1 AND action='insurance.request.failed'", [command.requestId])).rowCount, 1);
            } finally {
                await admin.query(`DROP TRIGGER ${trigger} ON audit.events`); await admin.query(`DROP FUNCTION public.${trigger}()`);
            }
        });
        await context.test('runtime cannot mutate evidence, bypass scope or delete case history', async () => {
            const client = await runtimePool!.connect();
            try {
                await client.query('BEGIN');
                await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)", [practiceId, locationId, userId]);
                assert.equal((await client.query('SELECT id FROM insurance_cases WHERE id=$1', [otherCaseId])).rowCount, 0);
                const rejected = async (sql: string, values: unknown[], code: string) => { await client.query('SAVEPOINT expected'); await assert.rejects(client.query(sql, values), error => (error as { code?: string }).code === code); await client.query('ROLLBACK TO SAVEPOINT expected'); };
                await rejected('SELECT * FROM audit.events', [], '42501');
                await rejected('UPDATE insurance_evidence SET reference=$2 WHERE id=$1', [firstEvidenceId, 'Changed'], '42501');
                await rejected('DELETE FROM insurance_cases WHERE id=$1', [caseId], '42501');
                await rejected('UPDATE insurance_cases SET patient_id=$2,revision=revision+1 WHERE id=$1', [caseId, otherPatientId], '23514');
                await rejected("UPDATE insurance_cases SET state='active',current_evidence_id=$2,revision=revision+1 WHERE id=$1", [caseId, firstEvidenceId], '23514');
                await rejected('SELECT * FROM audit.insurance_activity($1)', [otherCaseId], '42501');
                await client.query('ROLLBACK');
            } finally { client.release(); }
        });
        await context.test('rescheduled and aged evidence requires operational recheck without rewriting observations', async () => {
            await admin.query("UPDATE appointments SET scheduled_at='2027-01-05T17:00:00.654321Z',revision=revision+1 WHERE id=$1", [appointments[0]]);
            let detail = await service.caseDetail(tenant, caseId, randomUUID());
            assert.equal(detail.case.recordedState, 'active'); assert.equal(detail.case.state, 'needs_follow_up'); assert.equal(detail.case.reviewState, 'stale'); assert.equal(detail.case.reviewReason, 'appointment_changed');
            const movedRange = insuranceRange({ from: '2027-01-05', to: '2027-01-05' });
            let dashboard = await service.managerSummary(tenant, movedRange, randomUUID());
            assert.equal(dashboard.summary.active, 0); assert.equal(dashboard.summary.stale, 1); assert.equal(dashboard.summary.needsFollowUp, 1);
            const oldObservation = new Date(Date.now() - 8 * 86400000).toISOString();
            await service.addEvidence(tenant, caseId, { source: 'phone', observedAt: oldObservation, reference: 'Synthetic older source', outcome: 'active', reasonCode: 'manual_verification' }, ctx(6));
            detail = await service.caseDetail(tenant, caseId, randomUUID());
            assert.equal(detail.case.reviewReason, 'observation_expired'); assert.equal(detail.case.state, 'needs_follow_up');
            const olderId = detail.case.currentEvidenceId;
            await service.addEvidence(tenant, caseId, { source: 'phone', observedAt: new Date(Date.now() - 60000).toISOString(), reference: 'Synthetic fresh source', outcome: 'active', reasonCode: 'manual_verification' }, ctx(7));
            detail = await service.caseDetail(tenant, caseId, randomUUID());
            assert.equal(detail.case.state, 'active'); assert.equal(detail.case.reviewState, 'current');
            assert.ok(detail.evidence.some((evidence: { id: string }) => evidence.id === olderId));
            dashboard = await service.managerSummary(tenant, movedRange, randomUUID());
            assert.equal(dashboard.summary.active, 1); assert.equal(dashboard.summary.stale, 0);
        });
        await context.test('cancelled visits leave manager counts and work queues while historical evidence remains readable', async () => {
            await admin.query("UPDATE appointments SET status='cancelled',cancelled_at=now(),cancelled_by_actor_id=$2,cancellation_reason_code='synthetic_cancelled',revision=revision+1 WHERE id=$1", [appointments[1], userId]);
            const queue = await service.listCases(tenant, range, randomUUID());
            assert.deepEqual(queue.items.map(item => item.id), [thirdCaseId]);
            const dashboard = await service.managerSummary(tenant, range, randomUUID());
            assert.equal(dashboard.summary.appointments, 2); assert.equal(dashboard.summary.tracked, 1); assert.equal(dashboard.summary.untracked, 1); assert.equal(dashboard.summary.unassigned, 1);
            assert.equal((await service.caseDetail(tenant, secondCaseId, randomUUID())).evidence.length, 2);
            const event = (await admin.query("SELECT metadata FROM audit.events WHERE practice_id=$1 AND action='manager.dashboard.read' ORDER BY recorded_at DESC,id DESC LIMIT 1", [practiceId])).rows[0];
            assert.equal(event.metadata.purpose, 'service_dates:2027-01-04/2027-01-04');
        });
    } finally {
        await runtimePool?.end();
        await admin.query(`DROP OWNED BY ${role}`); await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end();
        if (old.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old.url;
        if (old.ssl === undefined) delete process.env.DATABASE_SSL_MODE; else process.env.DATABASE_SSL_MODE = old.ssl;
    }
});
