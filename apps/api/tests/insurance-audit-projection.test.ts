import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';

const url = isolatedTestDatabaseUrl();

test('insurance business events join existing scoped patient and appointment activity without exposing audit evidence', { skip: !url }, async () => {
    const pool = new Pool({ connectionString: url, ssl: false, max: 1 }), client = await pool.connect();
    const practice = randomUUID(), location = randomUUID(), otherLocation = randomUUID(), patient = randomUUID(), otherPatient = randomUUID(), appointment = randomUUID(), otherAppointment = randomUUID();
    const actor = 'synthetic_insurance_projection_actor';
    const actions = ['insurance.case.created', 'insurance.coverage.revised', 'insurance.evidence.recorded', 'insurance.evidence.corrected', 'insurance.follow_up.revised'];
    const accepted = new Set<string>();
    try {
        await client.query('BEGIN');
        await client.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status,owner_user_id) VALUES($1,$2,'Synthetic insurance activity','location','active',$3)", [practice, 'org_' + practice, actor]);
        await client.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic A','America/Los_Angeles'),($2,$3,'Synthetic B','America/Los_Angeles')", [location, otherLocation, practice]);
        await client.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,'synthetic_insurance_membership','active')", [practice, actor]);
        await client.query('INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2),($1,$2,$4,true,$2)', [practice, actor, location, otherLocation]);
        await client.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$3,$4,'Secret patient','A'),($2,$3,$5,'Secret patient','B')", [patient, otherPatient, practice, location, otherLocation]);
        await client.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,scheduled_at) VALUES($1,$3,$4,$6,'2027-01-04T10:00:00Z'),($2,$3,$5,$7,'2027-01-04T10:00:00Z')", [appointment, otherAppointment, practice, location, otherLocation, patient, otherPatient]);
        await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)", [practice, location, actor]);
        await client.query('SET LOCAL ROLE careiq_clinical_runtime');
        const emit = async (action: string, outcome = 'succeeded', patientId = patient, appointmentId = appointment) => {
            const result = await client.query('SELECT audit.record_event($1::jsonb,$2::jsonb) AS id', [JSON.stringify({ action, entityType: 'insurance_case', entityId: randomUUID(), outcome, reasonCode: 'PRIVATE_REASON_NOT_FOR_ACTIVITY', metadata: { purpose: 'PRIVATE_METADATA_NOT_FOR_ACTIVITY' } }), JSON.stringify([{ resourceType: 'patient', resourceId: patientId, patientId }, { resourceType: 'appointment', resourceId: appointmentId, patientId }])]);
            return result.rows[0].id as string;
        };
        for (const action of actions) accepted.add(await emit(action));
        const legacy = await emit('patients.update'); accepted.add(legacy);
        const denied = await emit('insurance.evidence.corrected', 'denied');
        const protectedEvent = await emit('audit.export.prepared');
        const commandAccepted = await emit('insurance.cases.create.accepted', 'accepted');
        const commandReplay = await emit('insurance.evidence.create.replay');
        await client.query("SELECT set_config('app.location_id',$1,true)", [otherLocation]);
        const foreign = await emit('insurance.evidence.recorded', 'succeeded', otherPatient, otherAppointment);
        await client.query("SELECT set_config('app.location_id',$1,true)", [location]);

        const byPatient = (await client.query('SELECT * FROM audit.activity($1::uuid)', [patient])).rows;
        assert.deepEqual(new Set(byPatient.map(row => row.id)), accepted);
        assert.deepEqual(new Set(byPatient.filter(row => row.action.startsWith('insurance.')).map(row => row.action)), new Set(actions));
        assert.equal(byPatient.some(row => [denied, protectedEvent, commandAccepted, commandReplay, foreign].includes(row.id)), false);
        for (const row of byPatient) {
            assert.deepEqual(Object.keys(row).sort(), ['id', 'occurred_at', 'action', 'entity_type', 'entity_id', 'outcome', 'actor_type', 'actor_id'].sort());
            assert.equal(row.actor_id, actor);
        }
        assert.equal(JSON.stringify(byPatient).includes('PRIVATE_'), false);
        const byAppointment = (await client.query('SELECT * FROM audit.activity(NULL,$1::uuid)', [appointment])).rows;
        assert.deepEqual(new Set(byAppointment.map(row => row.id)), accepted);
        assert.equal((await client.query('SELECT * FROM audit.activity($1::uuid)', [otherPatient])).rowCount, 0);
        assert.equal((await client.query('SELECT * FROM audit.activity(NULL,$1::uuid)', [otherAppointment])).rowCount, 0);
        const firstPage = (await client.query('SELECT *,occurred_at::text AS seek_time FROM audit.activity($1::uuid,NULL,NULL,2)', [patient])).rows;
        const last = firstPage.at(-1)!;
        const nextPage = (await client.query('SELECT * FROM audit.activity($1::uuid,NULL,NULL,100,$2::timestamptz,$3::uuid)', [patient, last.seek_time, last.id])).rows;
        assert.deepEqual(new Set([...firstPage, ...nextPage].map(row => row.id)), accepted);
        assert.equal(firstPage.some(row => nextPage.some(next => next.id === row.id)), false);
        await client.query('SAVEPOINT raw_audit_denied');
        await assert.rejects(client.query('SELECT * FROM audit.events'), error => (error as { code?: string }).code === '42501');
        await client.query('ROLLBACK TO SAVEPOINT raw_audit_denied');
        await client.query("SELECT set_config('app.location_id','',true)");
        await assert.rejects(client.query('SELECT * FROM audit.activity()'), error => (error as { code?: string }).code === '42501');
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
});
