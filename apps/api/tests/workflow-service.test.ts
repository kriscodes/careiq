import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import { fingerprint, readiness, revision, assertTransition, WorkflowError } from '../src/workflow/policy.js';
const url = isolatedTestDatabaseUrl();
test('workflow policy handles readiness, strict concurrency and target-bound retry fingerprints', () => {
    assert.equal(readiness([]).status, 'not_required');
    assert.equal(readiness([{ required: true, lifecycleState: 'active', progressState: 'needs_review' }]).status, 'not_ready');
    assert.equal(readiness([{ required: true, lifecycleState: 'waived', progressState: 'waived' }]).status, 'ready');
    assert.throws(() => revision(undefined), e => e instanceof WorkflowError && e.status === 428);
    assert.equal(revision('"4"'), 4);
    assert.throws(() => assertTransition('completed', 'scheduled'));
    assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
    assert.notEqual(fingerprint({ target: 'one' }), fingerprint({ target: 'two' }));
});
test('workflow services persist booking, rules, versions, reviews, requests and patient signing under restricted runtime', { skip: !url }, async (context) => {
    const admin = new Pool({ connectionString: url, ssl: false });
    const role = 'careiq_workflow_test_' + randomBytes(6).toString('hex'), password = randomBytes(24).toString('hex');
    const practiceId = randomUUID(), locationId = randomUUID(), userId = 'synthetic_workflow_' + randomUUID(), membershipId = 'membership_' + randomUUID();
    const tenant = { practiceId, locationId, userId, membershipId, orgId: 'org_' + practiceId };
    let runtimePool: Pool | undefined;
    const storage = await mkdtemp(join(tmpdir(), 'careiq-workflow-'));
    const old = { url: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL_MODE, storage: process.env.CAREIQ_PRIVATE_STORAGE_DIR };
    try {
        await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
        await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
        await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic API workflow','location','active')", [practiceId, tenant.orgId]);
        await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$2,'Synthetic clinic','America/Los_Angeles')", [locationId, practiceId]);
        await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')", [practiceId, userId, membershipId]);
        await admin.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)', [practiceId, userId, locationId]);
        const runtimeUrl = new URL(url!);
        runtimeUrl.username = role;
        runtimeUrl.password = password;
        process.env.DATABASE_URL = runtimeUrl.href;
        process.env.DATABASE_SSL_MODE = 'disable';
        process.env.CAREIQ_PRIVATE_STORAGE_DIR = storage;
        const service = await import('../src/services/workflow.service.js');
        ({ pool: runtimePool } = await import('../src/db/client.js'));
        const ctx = (expectedRevision?: number) => ({ requestId: randomUUID(), idempotencyKey: randomUUID(), expectedRevision });
        const run = (action: string, target: string, body: unknown, expectedRevision?: number) => service.execute(tenant, action, target, body, ctx(expectedRevision));
        let patientId = '', providerId = '', typeId = '', documentTypeId = '', appointmentId = '', requirementId = '', templateId = '', versionId = '', documentId = '';
        await context.test('create catalogs, publish rules, book adjacent appointments and reject conflicting slots', async () => {
            patientId = (await run('patients.create', '', { firstName: 'Synthetic', lastName: 'Patient' })).id as string;
            providerId = (await run('providers.create', '', { displayName: 'Synthetic provider' })).id as string;
            typeId = (await run('visit-types.create', '', { code: 'test', name: 'Synthetic visit', defaultDurationMinutes: 30 })).id as string;
            documentTypeId = (await run('document-types.create', '', { code: 'consent', name: 'Synthetic consent' })).id as string;
            await run('providers.availability', providerId, { rules: [{ isoWeekday: 1, startsAtLocal: '08:00', endsAtLocal: '18:00', effectiveFrom: '2026-01-01' }] }, 1);
            await run('rules.publication', '', { title: 'Synthetic rules', rules: [{ documentTypeId, visitTypeId: typeId, required: true, reviewRequired: true, signatureRequired: false, reusePolicy: 'none' }] });
            const input = { patientId, providerId, visitTypeId: typeId, scheduledAt: '2027-01-04T09:00:00-08:00', endsAt: '2027-01-04T09:30:00-08:00' };
            const retryContext = ctx();
            appointmentId = (await service.execute(tenant, 'appointments.create', '', input, retryContext)).id as string;
            assert.equal((await service.execute(tenant, 'appointments.create', '', input, retryContext)).id, appointmentId);
            await assert.rejects(service.execute(tenant, 'appointments.create', '', { ...input, reason: 'changed' }, retryContext), e => e instanceof WorkflowError && e.code === 'IDEMPOTENCY_KEY_REUSED');
            await assert.rejects(run('appointments.create', '', input));
            const snapshot = await service.snapshot(tenant, Object.fromEntries(['patientsRead', 'appointmentsRead', 'documentsRead', 'documentsReview', 'appointmentsUpdate', 'configurationManage'].map(k => [k, true])), randomUUID());
            assert.equal(snapshot.appointments[0].readiness.status, 'not_ready');
            requirementId = snapshot.appointments[0].requirements[0].id;
            assert.equal(snapshot.appointments[0].requirements.length, 1);
        });
        await context.test('rescheduling preserves snapshotted rules and visit-type changes reconcile due dates exactly once', async () => {
            const secondType = (await run('visit-types.create', '', { code: 'follow_up', name: 'Synthetic follow-up', defaultDurationMinutes: 30 })).id as string;
            await run('rules.publication', '', { title: 'New synthetic rules', rules: [{ documentTypeId, required: true, reviewRequired: true, reusePolicy: 'none', dueOffsetMinutes: -60 }] });
            await run('appointments.update', appointmentId, { scheduledAt: '2027-01-04T10:00:00-08:00', endsAt: '2027-01-04T10:30:00-08:00' }, 1);
            let requirement = (await admin.query('SELECT * FROM visit_requirements WHERE id=$1', [requirementId])).rows[0];
            assert.equal(requirement.due_at.toISOString(), '2027-01-04T18:00:00.000Z');
            await run('appointments.update', appointmentId, { scheduledAt: '2027-01-04T11:00:00-08:00', endsAt: '2027-01-04T11:30:00-08:00', visitTypeId: secondType }, 2);
            requirement = (await admin.query('SELECT * FROM visit_requirements WHERE id=$1', [requirementId])).rows[0];
            assert.equal(requirement.due_at.toISOString(), '2027-01-04T18:00:00.000Z');
            const work = (await admin.query("SELECT due_at FROM work_items WHERE requirement_id=$1 AND state='open'", [requirementId])).rows[0];
            assert.equal(work.due_at.toISOString(), requirement.due_at.toISOString());
        });
        await context.test('render a published immutable template and accept exact-version evidence', async () => {
            templateId = (await run('templates.create', '', { documentTypeId, title: 'Synthetic consent', content: 'Synthetic consent body', fieldSchema: [{ key: 'patient_name', label: 'Name', type: 'text', required: true }] })).id as string;
            await run('templates.publication', templateId, {}, 1);
            const snapshot = await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: true }, randomUUID());
            const template = snapshot.templates.find((t: any) => t.id === templateId);
            const prepared = await run('templates.preparation', patientId, { patientId, appointmentId, requirementId, templateVersionId: template.publishedVersionId, answers: { patient_name: 'Synthetic Patient' } });
            versionId = prepared.documentVersionId as string;
            documentId = prepared.documentId as string;
            const doc = (await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: true }, randomUUID())).documents.find((d: any) => d.id === documentId);
            await run('documents.review', versionId, { decision: 'accepted', requirementIds: [requirementId], expectedDocumentRevision: doc.revision });
            assert.equal((await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: true }, randomUUID())).appointments.find((a: any) => a.id === appointmentId).readiness.status, 'ready');
            const summaryOnly = await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: false }, randomUUID());
            assert.equal(summaryOnly.appointments.find((a: any) => a.id === appointmentId).readiness.status, 'ready');
            assert.deepEqual(summaryOnly.documents, []);
            assert.equal(summaryOnly.appointments.find((a: any) => a.id === appointmentId).requirements[0].selectedEvidence, null);
        });
        await context.test('stale changes fail and correction revokes previously accepted evidence', async () => {
            await assert.rejects(run('patients.update', patientId, { phone: '555-0100' }, 99), e => e instanceof WorkflowError && e.status === 412);
            const snapshot = await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: true }, randomUUID());
            const doc = snapshot.documents.find((d: any) => d.id === documentId);
            const head = doc.currentVersion.review;
            await run('documents.review', versionId, { decision: 'replacement_required', reasonCode: 'incorrect_document', supersedesReviewId: head.id, requirementIds: [requirementId], expectedDocumentRevision: doc.revision });
            assert.equal((await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: true }, randomUUID())).appointments.find((a: any) => a.id === appointmentId).readiness.status, 'not_ready');
        });
        await context.test('signing link has request-only authority and produces distinct immutable PDF and evidence', async () => {
            const result = await run('requests.create', patientId, { patientId, appointmentId, purpose: 'signature', items: [{ requirementId, sourceDocumentVersionId: versionId }], recipient: { name: 'Synthetic Patient', channel: 'local_review' } });
            assert.match(result.localReviewPath as string, /^\/patient-workflow#token=/);
            const token = (result.localReviewPath as string).split('=')[1];
            const exchanged = await service.exchangePatientSession({ token }, randomUUID());
            const request = await service.patientRequest(exchanged.sessionToken, randomUUID());
            assert.equal(request.id, result.id);
            const source = await service.patientDocument(exchanged.sessionToken, randomUUID());
            assert.ok(source.bytes.length > 0);
            const payload = { expectedRevision: request.signature!.revision, sourceSha256: request.signature!.sourceSha256, consent: { accepted: true, textVersion: request.signature!.consentTextVersion }, fields: [{ key: 'patient_signature', type: 'typed_signature', value: 'Synthetic Patient' }] };
            const completionKey = randomUUID();
            await assert.rejects(service.patientCompletion(exchanged.sessionToken, { ...payload, fields: [{ key: 'patient_signature', type: 'text', value: 'Synthetic Patient' }] }, randomUUID(), randomUUID()), e => e instanceof WorkflowError && e.code === 'INVALID_SIGNATURE_FIELDS');
            const signed = await service.patientCompletion(exchanged.sessionToken, payload, completionKey, randomUUID());
            assert.equal((await service.patientCompletion(exchanged.sessionToken, payload, completionKey, randomUUID())).documentVersionId, signed.documentVersionId);
            const sessionFact=(await admin.query('SELECT verification_method,assurance FROM patient_sessions WHERE request_id=$1',[result.id])).rows[0];assert.equal(sessionFact.verification_method,'email_link');assert.equal(sessionFact.assurance,'link_possession');
            const receiptFacts=(await admin.query("SELECT authorization_context FROM audit.events WHERE entity_id=$1 AND action='signatures.completion.receipt_access'",[result.id])).rows;assert.ok(receiptFacts.length>0);for(const event of receiptFacts){assert.equal(event.authorization_context.verificationMethod,'email_link');assert.equal(event.authorization_context.assurance,'link_possession');}
            await assert.rejects(service.patientCompletion(exchanged.sessionToken, { ...payload, sourceSha256: 'a'.repeat(64) }, completionKey, randomUUID()), e => e instanceof WorkflowError && e.code === 'IDEMPOTENCY_KEY_REUSED');
            assert.equal(signed.state, 'completed');
            assert.notEqual(signed.documentVersionId, versionId);
            const packet = (await admin.query('SELECT * FROM signature_packets WHERE request_id=$1', [result.id])).rows[0];
            assert.ok(packet.evidence_object_id);
            assert.equal(packet.state, 'completed');
            assert.equal((await admin.query('SELECT state FROM document_requests WHERE id=$1', [result.id])).rows[0].state, 'completed');
        });
        await context.test('patient collection verifies bytes, quarantines without scanner and completes only after configured clean verdict', async () => {
            const result = await run('requests.create', patientId, { patientId, appointmentId, purpose: 'collection', items: [{ requirementId }], recipient: { name: 'Synthetic Patient', channel: 'local_review' } });
            const token = (result.localReviewPath as string).split('=')[1];
            const exchanged = await service.exchangePatientSession({ token }, randomUUID());
            const snapshot = await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: true }, randomUUID());
            const doc = snapshot.documents.find((d: any) => d.id === documentId);
            const source = await service.documentContent(tenant, doc.currentVersionId, randomUUID());
            const { sha256 } = await import('../src/workflow/storage.js');
            const file = { name: 'synthetic.pdf', contentType: 'application/pdf', sizeBytes: source.bytes.length, sha256: sha256(source.bytes) };
            const reservation = await service.patientUploadReservation(exchanged.sessionToken, { requirementId, file }, randomUUID(), randomUUID());
            await assert.rejects(service.patientUploadContent(exchanged.sessionToken, reservation.id, Buffer.from('wrong'), randomUUID()), e => e instanceof WorkflowError && e.code === 'UPLOAD_INTEGRITY_MISMATCH');
            await service.patientUploadContent(exchanged.sessionToken, reservation.id, source.bytes, randomUUID());
            delete process.env.CAREIQ_SCANNER_COMMAND;
            const quarantined = await service.patientUploadCompletion(exchanged.sessionToken, reservation.id, { sizeBytes: file.sizeBytes, sha256: file.sha256 }, randomUUID(), randomUUID());
            assert.equal(quarantined.state, 'quarantined');
            assert.equal((await service.patientRequest(exchanged.sessionToken, randomUUID())).state, 'open');
            // A deterministic clean adapter validates pipeline transitions; it is never configured for review/runtime.
            process.env.CAREIQ_SCANNER_COMMAND = '/usr/bin/true';
            try {
                const completionKey = randomUUID();
                const completed = await service.patientUploadCompletion(exchanged.sessionToken, reservation.id, { sizeBytes: file.sizeBytes, sha256: file.sha256 }, completionKey, randomUUID());
                assert.equal((await service.patientUploadCompletion(exchanged.sessionToken, reservation.id, { sizeBytes: file.sizeBytes, sha256: file.sha256 }, completionKey.toUpperCase(), randomUUID())).documentVersionId, completed.documentVersionId);
                await assert.rejects(service.patientUploadCompletion(exchanged.sessionToken, reservation.id, { sizeBytes: 1, sha256: file.sha256 }, completionKey, randomUUID()), e => e instanceof WorkflowError && e.code === 'IDEMPOTENCY_KEY_REUSED');
                assert.equal(completed.requestState, 'completed');
                assert.equal(completed.state, 'available');
                assert.equal((await admin.query('SELECT state FROM document_requests WHERE id=$1', [result.id])).rows[0].state, 'completed');
                assert.ok((await admin.query("SELECT id FROM work_items WHERE requirement_id=$1 AND kind='review' AND state='open'", [requirementId])).rowCount);
            }
            finally {
                delete process.env.CAREIQ_SCANNER_COMMAND;
            }
        });
        await context.test('concurrent upload candidates retain scan evidence and require explicit stale-head resolution', async () => {
            const doc = (await service.snapshot(tenant, { patientsRead: true, appointmentsRead: true, documentsRead: true }, randomUUID())).documents.find((d: any) => d.id === documentId);
            const source = await service.documentContent(tenant, doc.currentVersionId, randomUUID());
            const { sha256 } = await import('../src/workflow/storage.js');
            const file = { name: 'candidate.pdf', contentType: 'application/pdf', sizeBytes: source.bytes.length, sha256: sha256(source.bytes) };
            const payload = { documentTypeId, existingDocumentId: documentId, baseVersionId: doc.currentVersionId, file };
            const a = await run('uploads.reservation', patientId, payload), b = await run('uploads.reservation', patientId, payload);
            await service.putUpload(tenant, a.id as string, source.bytes, randomUUID());
            await service.putUpload(tenant, b.id as string, source.bytes, randomUUID());
            process.env.CAREIQ_SCANNER_COMMAND = '/usr/bin/true';
            try {
                const first = await run('uploads.completion', a.id as string, {});
                const second = await run('uploads.completion', b.id as string, {});
                assert.equal(first.promotion, 'current');
                assert.equal(second.promotion, 'requires_resolution');
                const current = (await admin.query('SELECT * FROM documents WHERE id=$1', [documentId])).rows[0];
                assert.equal(current.current_version_id, a.documentVersionId);
                const selected = await run('documents.current-version', documentId, { documentVersionId: b.documentVersionId, reasonCode: 'selected_valid_candidate' }, Number(current.revision));
                assert.equal(selected.documentVersionId, b.documentVersionId);
                assert.equal((await admin.query("SELECT count(*)::integer AS count FROM file_scan_runs WHERE file_object_id IN(SELECT file_object_id FROM document_versions WHERE id=ANY($1::uuid[])) AND verdict='clean'", [[a.documentVersionId, b.documentVersionId]])).rows[0].count, 2);
            }
            finally {
                delete process.env.CAREIQ_SCANNER_COMMAND;
            }
        });
        await context.test('decline terminal retries preserve their original receipt without document access', async () => {
            const created = await run('requests.create', patientId, { patientId, appointmentId, purpose: 'collection', items: [{ requirementId }], recipient: { name: 'Synthetic Patient', channel: 'local_review' } });
            const token = (created.localReviewPath as string).split('=')[1];
            const session = await service.exchangePatientSession({ token }, randomUUID());
            const key = randomUUID();
            const declined = await service.patientDecline(session.sessionToken, { reasonCode: 'patient_declined' }, key, randomUUID());
            assert.equal(declined.state, 'declined');
            assert.deepEqual(await service.patientDecline(session.sessionToken, { reasonCode: 'patient_declined' }, key.toUpperCase(), randomUUID()), declined);
            await assert.rejects(service.patientDocument(session.sessionToken, randomUUID()), e => e instanceof WorkflowError && e.status === 410);
        });
        await context.test('clinical activity cursors preserve exact records and reject changed actor/filter bindings', async () => {
            const first = await service.activity(tenant, { patientId, limit: 2 }, randomUUID());
            assert.equal(first.items.length, 2);
            assert.equal(first.hasMore, true);
            assert.equal(typeof first.nextCursor, 'string');
            const second = await service.activity(tenant, { patientId, limit: 2, cursor: first.nextCursor! }, randomUUID());
            assert.equal(new Set([...first.items, ...second.items].map(i => i.id)).size, 4);
            await assert.rejects(service.activity(tenant, { patientId, limit: 3, cursor: first.nextCursor! }, randomUUID()), e => e instanceof WorkflowError && e.code === 'INVALID_CURSOR');
        });
        await context.test('HTTP routes enforce permissions, preconditions and audited failures without breaking legacy injection', async () => {
            const { createApiApp } = await import('../src/app.js');
            const caps = { patients: { read: true, create: true }, appointments: { read: true, create: true } };
            let permissions = ['org:patients:update', 'org:documents:read', 'org:documents:upload', 'org:documents:review', 'org:workflow:configure', 'org:appointments:update'];
            const auth = { isAuthenticated: true, userId, orgId: tenant.orgId, has: () => true };
            const app = createApiApp({ authenticate: (_req, _res, next) => next(), getAuth: () => auth, health: async () => true, findPracticeByClerkOrgId: async () => ({ id: practiceId }), practiceAccess: { authorizeLocation: async () => ({ tenant, capabilities: caps, permissions }) } as any, workflow: service, listPatients: async () => [], listAppointments: async () => [], createPatient: async () => ({}), createAppointment: async () => ({}) }, { origins: ['http://127.0.0.1'], trustedProxies: false, interviews: { enabled: false, store: async () => { } } });
            const server = app.listen(0, '127.0.0.1');
            await new Promise<void>(resolve => server.once('listening', resolve));
            const address = server.address() as {
                port: number;
            };
            const base = `http://127.0.0.1:${address.port}/api/v1/locations/${locationId}/workflow`;
            try {
                let response = await fetch(base);
                assert.equal(response.status, 200);
                const workspace = await response.json() as any;
                assert.ok(workspace.data.appointments.length);
                response = await fetch(base + '/patients/' + patientId, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ phone: '555-0100' }) });
                assert.equal(response.status, 428);
                permissions = [];
                response = await fetch(base + '/patients/' + patientId, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'If-Match': '"1"' }, body: JSON.stringify({ phone: '555-0100' }) });
                assert.equal(response.status, 403);
                assert.ok((await admin.query("SELECT id FROM audit.events WHERE practice_id=$1 AND action='workflow.request.failed' AND outcome='denied'", [practiceId])).rowCount);
                response = await fetch(`http://127.0.0.1:${address.port}/api/v1/patient-workflows/session-exchanges`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'invalid' }) });
                assert.equal(response.status, 410);
                response = await fetch(base + '/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken"' });
                assert.equal(response.status, 400);
                const invalid = await response.json() as any;
                assert.equal(invalid.error.code, 'INVALID_REQUEST');
                assert.equal((await admin.query('SELECT scope_kind FROM audit.events WHERE request_id=$1', [invalid.error.requestId])).rows[0].scope_kind, 'platform');
                permissions = ['org:workflow:configure'];
                caps.patients.read = false;
                caps.appointments.read = false;
                response = await fetch(base);
                assert.equal(response.status, 200);
                const configOnly = await response.json() as any;
                assert.deepEqual(configOnly.data.patients, []);
                assert.deepEqual(configOnly.data.documents, []);
                assert.ok(configOnly.data.templates.length > 0);
                response = await fetch(base + '/providers/' + providerId + '/availability');
                assert.equal(response.status, 200);
            }
            finally {
                server.closeAllConnections();
                await new Promise<void>(resolve => server.close(() => resolve()));
            }
        });
    }
    finally {
        await runtimePool?.end();
        await admin.query(`DROP OWNED BY ${role}`);
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
        await admin.end();
        await rm(storage, { recursive: true, force: true });
        if (old.url === undefined)
            delete process.env.DATABASE_URL;
        else
            process.env.DATABASE_URL = old.url;
        if (old.ssl === undefined)
            delete process.env.DATABASE_SSL_MODE;
        else
            process.env.DATABASE_SSL_MODE = old.ssl;
        if (old.storage === undefined)
            delete process.env.CAREIQ_PRIVATE_STORAGE_DIR;
        else
            process.env.CAREIQ_PRIVATE_STORAGE_DIR = old.storage;
    }
});
