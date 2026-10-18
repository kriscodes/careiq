import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import { WorkflowError } from '../src/workflow/policy.js';
const url = isolatedTestDatabaseUrl();
const error = (code: string) => (e: unknown) => e instanceof WorkflowError && e.code === code;
test('guided forms publication and frozen submissions retain governed source history under restricted runtime', { skip: !url }, async (context) => {
    const admin = new Pool({ connectionString: url, ssl: false }), role = 'careiq_forms_test_' + randomBytes(6).toString('hex'), password = randomBytes(24).toString('hex');
    const practiceId = randomUUID(), locationId = randomUUID(), otherLocationId = randomUUID(), userId = 'synthetic_forms_' + randomUUID(), membershipId = 'membership_' + randomUUID(), tenant = { practiceId, locationId, userId, membershipId, orgId: 'org_' + practiceId };
    const storage = await mkdtemp(join(tmpdir(), 'careiq-forms-')), old = { url: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL_MODE, storage: process.env.CAREIQ_PRIVATE_STORAGE_DIR };
    let runtime: Pool | undefined;
    try {
        await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
        await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
        await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic forms','location','active')", [practiceId, tenant.orgId]);
        await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic forms A','UTC'),($2,$3,'Synthetic forms B','UTC')", [locationId, otherLocationId, practiceId]);
        await admin.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active')", [practiceId, userId, membershipId]);
        await admin.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2),($1,$2,$4,true,$2)', [practiceId, userId, locationId, otherLocationId]);
        const runtimeUrl = new URL(url!);
        runtimeUrl.username = role;
        runtimeUrl.password = password;
        process.env.DATABASE_URL = runtimeUrl.href;
        process.env.DATABASE_SSL_MODE = 'disable';
        process.env.CAREIQ_PRIVATE_STORAGE_DIR = storage;
        const service = await import('../src/services/workflow.service.js');
        ({ pool: runtime } = await import('../src/db/client.js'));
        const { formChanges } = await import('../src/services/form-changes.service.js');
        const ctx = (expectedRevision?: number) => ({ requestId: randomUUID(), idempotencyKey: randomUUID(), expectedRevision }), run = (action: string, target: string, input: unknown, revision?: number) => service.execute(tenant, action, target, input, ctx(revision));
        const patientId = (await run('patients.create', '', { firstName: 'Synthetic', lastName: 'Form', dateOfBirth: '1990-01-01' })).id as string;
        const documentTypeId = (await run('document-types.create', '', { code: 'forms_test', name: 'Synthetic intake' })).id as string;
        const fields = [{ id: 'preferred', key: 'preferred', label: 'Preferred name', type: 'text', required: true }, { id: 'show_note', key: 'show_note', label: 'Add note?', type: 'checkbox' }, { id: 'note', key: 'note', label: 'Note', type: 'textarea', required: true }];
        const formSchema = { mode: 'guided', defaultLocale: 'en', completionPolicy: 'form_only', sections: [], rules: [{ id: 'note_condition', sourceFieldKey: 'show_note', targetFieldKey: 'note', operator: 'checked' }], bindings: [{ fieldKey: 'preferred', destination: 'patient.preferredName', reviewRequired: true }], signing: { roles: [], consentText: '', consentTextVersion: '' }, delivery: { emailCopy: false } };
        const templateId = (await run('templates.create', '', { documentTypeId, title: 'Synthetic intake', content: 'Please confirm your information.', schemaVersion: 2, fieldSchema: fields, formSchema })).id as string;
        const draft = (await admin.query('SELECT * FROM template_versions WHERE template_id=$1', [templateId])).rows[0];
        await context.test('validation binds exact draft revision, publication freezes schema and mapping', async () => {
            const validation = await run('templates.validation', draft.id, {}, 1);
            assert.equal(validation.valid, true);
            assert.equal(validation.draftRevision, 1);
            await assert.rejects(run('templates.version-update', draft.id, { content: 'Conflicting' }, 99), error('REVISION_CONFLICT'));
            await assert.rejects(run('templates.publication',templateId,{versionId:draft.id},1),error('PRECONDITION_REQUIRED'));
            await assert.rejects(run('templates.publication',templateId,{versionId:draft.id,expectedDraftRevision:99},1),error('REVISION_CONFLICT'));
            const published = await run('templates.publication', templateId, { versionId: draft.id, expectedDraftRevision:1 }, 1);
            assert.equal(published.state, 'published');
            await assert.rejects(run('templates.version-update', draft.id, { content: 'Changed' }, 2), error('PUBLISHED_VERSION_IMMUTABLE'));
            assert.equal((await admin.query('SELECT count(*)::integer AS count FROM template_field_bindings WHERE template_version_id=$1', [draft.id])).rows[0].count, 1);
            await run('templates.update',templateId,{title:'Renamed logical template'},2);
            const frozen=(await admin.query('SELECT * FROM template_versions WHERE id=$1',[draft.id])).rows[0];assert.equal(frozen.form_schema.documentTitle,'Synthetic intake');
        });
        let preparedId = '', documentVersionId = '', candidateId = '';
        await context.test('freeze drops hidden answers, stores exact source and creates reviewed change candidates', async () => {
            const prepared = await run('templates.preparation', patientId, { patientId, templateVersionId: draft.id, answers: { preferred: 'Synthetic preferred', show_note: false, note: 'inactive secret' } });
            preparedId = prepared.id as string;
            documentVersionId = prepared.documentVersionId as string;
            const source = (await admin.query('SELECT * FROM form_submissions WHERE prepared_document_id=$1', [preparedId])).rows[0];
            assert.equal(source.answers.note, undefined);
            assert.equal(source.document_version_id, documentVersionId);
            const output = (await admin.query('SELECT * FROM document_versions WHERE id=$1', [documentVersionId])).rows[0];
            assert.equal((await admin.query('SELECT title FROM documents WHERE id=$1',[output.document_id])).rows[0].title,'Synthetic intake');
            assert.deepEqual(output.structured_answers, source.answers);
            assert.equal(output.answers_schema_version, 2);
            assert.equal((await admin.query('SELECT scan_reference FROM file_objects WHERE id=$1',[output.file_object_id])).rows[0].scan_reference,'careiq-guided-form-renderer-v2');
            const review = await formChanges(tenant, patientId, randomUUID());
            candidateId = review.items[0].id;
            assert.equal(review.items[0].state, 'pending');
            assert.equal(review.patient.preferredName, null);
            assert.equal((await formChanges({ ...tenant, locationId: otherLocationId }, patientId, randomUUID()).catch((e: WorkflowError) => e)).code, 'RESOURCE_NOT_FOUND');
        });
        await context.test('staff review uses fresh chart revision and retains append-only evidence', async () => {
            await assert.rejects(run('form-changes.decisions', candidateId, { decision: 'accepted', reasonCode: 'confirmed', expectedPatientRevision: 99 }, 1), error('REVISION_CONFLICT'));
            const changed = await run('form-changes.decisions', candidateId, { decision: 'accepted', reasonCode: 'confirmed', expectedPatientRevision: 1 }, 1);
            assert.equal(changed.patientRevision, 2);
            const patient = (await admin.query('SELECT * FROM patients WHERE id=$1', [patientId])).rows[0];
            assert.equal(patient.preferred_name, 'Synthetic preferred');
            const facts = await admin.query('SELECT * FROM form_change_decisions WHERE candidate_id=$1', [candidateId]);
            assert.equal(facts.rowCount, 1);
            await assert.rejects(admin.query("UPDATE form_submissions SET answers='{}' WHERE prepared_document_id=$1", [preparedId]), (e: any) => e.code === '23514');
            await assert.rejects(admin.query("UPDATE prepared_documents SET answers='{}' WHERE id=$1", [preparedId]), (e: any) => e.code === '23514');
            const audit = (await admin.query("SELECT before_evidence,after_evidence FROM audit.database_records WHERE table_name IN('form_submissions','form_change_candidates') AND practice_id=$1", [practiceId])).rows;
            assert.equal(JSON.stringify(audit).includes('Synthetic preferred'), false);
        });
    }
    finally {
        await runtime?.end();
        await admin.query(`DROP OWNED BY ${role}`);
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
        await admin.end();
        await rm(storage, { recursive: true, force: true });
        for (const [key, value] of Object.entries(old)) {
            const name = key === 'url' ? 'DATABASE_URL' : key === 'ssl' ? 'DATABASE_SSL_MODE' : 'CAREIQ_PRIVATE_STORAGE_DIR';
            if (value === undefined)
                delete process.env[name];
            else
                process.env[name] = value;
        }
    }
});
