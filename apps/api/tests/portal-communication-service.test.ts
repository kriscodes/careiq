import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import { WorkflowError } from '../src/workflow/policy.js';
import { preferenceContext } from '../src/notifications/portal-preference-policy.js';

const databaseUrl = isolatedTestDatabaseUrl();
const rejectedWith = (expected: string) => (cause: unknown) => cause instanceof WorkflowError && cause.code === expected;
type Choice = { endpointId: string; purpose: 'request' | 'reminder' | 'paperwork'; allowed: boolean };
type Endpoint = { id: string; channel: 'email' | 'sms'; masked: string; suppressed: boolean; paperworkEligible: boolean; choices: Record<Choice['purpose'], boolean> };
type Profile = { contextToken: string; revision: number; practiceName: string; locationName: string; endpoints: Endpoint[] };

test('portal communication choices enforce account ownership, independent consent and write concurrency under the restricted runtime', { skip: !databaseUrl }, async context => {
  const admin = new Pool({ connectionString: databaseUrl, ssl: false });
  const suffix = randomUUID().replaceAll('-', ''), role = 'careiq_portal_choices_test_' + suffix, password = randomUUID();
  const practiceId = randomUUID(), otherPracticeId = randomUUID(), locationId = randomUUID(), otherLocationId = randomUUID();
  const patientId = randomUUID(), otherPatientId = randomUUID(), grantId = randomUUID(), otherGrantId = randomUUID();
  const emailId = randomUUID(), smsId = randomUUID(), otherEndpointId = randomUUID();
  const subject = 'user_Portal' + suffix, otherSubject = 'user_Other' + suffix, session = 'sess_Portal' + suffix;
  const emailAddress = 'portal-' + suffix + '@example.test', smsAddress = '+12025550123';
  const emailFingerprint = 'a'.repeat(64), smsFingerprint = 'b'.repeat(64), otherFingerprint = 'c'.repeat(64);
  const emailAccount = 'synthetic-portal-email-' + suffix, smsAccount = 'synthetic-portal-sms-' + suffix;
  const names = ['DATABASE_URL', 'DATABASE_SSL_MODE', 'CAREIQ_RESEND_ACCOUNT', 'CAREIQ_TWILIO_ACCOUNT_SID'] as const;
  const previousEnvironment = Object.fromEntries(names.map(name => [name, process.env[name]]));
  let runtime: Pool | undefined;
  try {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
    await admin.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$3,'Synthetic portal choices','location','active'),($2,$4,'Other synthetic practice','location','active')", [practiceId, otherPracticeId, 'org_Portal' + suffix, 'org_Other' + suffix]);
    await admin.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic portal location','UTC'),($2,$4,'Other synthetic location','UTC')", [locationId, otherLocationId, practiceId, otherPracticeId]);
    await admin.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name,date_of_birth) VALUES($1,$3,$4,'Synthetic','Portal choices','1980-01-01'),($2,$5,$6,'Private other','Patient','1980-01-01')", [patientId, otherPatientId, practiceId, locationId, otherPracticeId, otherLocationId]);
    await admin.query("INSERT INTO patient_portal_grants(id,practice_id,location_id,patient_id,clerk_user_id,relationship,verification_method,verification_reference,verified_by_actor_id,expires_at,paperwork_email_enabled) VALUES($1,$3,$4,$5,$6,'self','staff_in_person','Synthetic verification','synthetic_staff',now()+interval '1 day',false),($2,$7,$8,$9,$10,'self','staff_in_person','Other private verification','synthetic_staff',now()+interval '1 day',false)", [grantId, otherGrantId, practiceId, locationId, patientId, subject, otherPracticeId, otherLocationId, otherPatientId, otherSubject]);
    await admin.query("INSERT INTO communication_endpoints(id,practice_id,location_id,patient_id,channel,address,address_fingerprint,verification_reference,verified_by_actor_id,time_zone) VALUES($1,$4,$5,$6,'email',$7,$8,'Synthetic verified destination','synthetic_staff','UTC'),($2,$4,$5,$6,'sms',$9,$10,'Synthetic verified SMS destination','synthetic_staff','UTC'),($3,$11,$12,$13,'email','private-other@example.test',$14,'Other private destination','synthetic_staff','UTC')", [emailId, smsId, otherEndpointId, practiceId, locationId, patientId, emailAddress, emailFingerprint, smsAddress, smsFingerprint, otherPracticeId, otherLocationId, otherPatientId, otherFingerprint]);
    const runtimeUrl = new URL(databaseUrl!); runtimeUrl.username = role; runtimeUrl.password = password;
    process.env.DATABASE_URL = runtimeUrl.href; process.env.DATABASE_SSL_MODE = 'disable'; process.env.CAREIQ_RESEND_ACCOUNT = emailAccount; process.env.CAREIQ_TWILIO_ACCOUNT_SID = smsAccount;
    const service = await import('../src/services/portal-communication.service.js');
    ({ pool: runtime } = await import('../src/db/client.js'));
    const profile = async () => {
      const result = await service.portalCommunicationPreferences(subject, session);
      assert.equal(result.profiles.length, 1);
      return result.profiles[0] as Profile;
    };
    const save = (value: Profile, choices: Choice[], key = randomUUID()) => service.portalCommunicationPreferences(subject, session, { input: { contextToken: value.contextToken, choices }, revision: value.revision, key });
    const countPermissionEvents = async () => Number((await admin.query('SELECT count(*) AS count FROM communication_permission_events WHERE patient_id=$1', [patientId])).rows[0].count);

    await context.test('only a live authenticated account sees its own masked destinations', async () => {
      await assert.rejects(service.portalCommunicationPreferences('', ''), rejectedWith('COMMUNICATION_PROFILE_UNAVAILABLE'));
      await assert.rejects(runtime!.query('SELECT careiq_portal_communication_choices()'), (cause: unknown) => (cause as { code?: string }).code === '42501');
      assert.deepEqual((await service.portalCommunicationPreferences('user_Unbound' + suffix, session)).profiles, []);
      const value = await profile();
      assert.deepEqual(new Set(value.endpoints.map(endpoint => endpoint.id)), new Set([emailId, smsId]));
      const serialized = JSON.stringify(value);
      for (const privateValue of [emailAddress, smsAddress, 'private-other@example.test', otherEndpointId, otherGrantId, emailFingerprint, smsFingerprint, 'Synthetic verified destination']) assert.equal(serialized.includes(privateValue), false);
      assert.equal(Object.hasOwn(value, 'grantId'), false); assert.equal(Object.hasOwn(value, 'patientId'), false);
      assert.equal((await runtime!.query('SELECT id FROM communication_endpoints')).rowCount, 0);
      assert.equal((await runtime!.query('SELECT id FROM portal_communication_profiles')).rowCount, 0);
    });
    await context.test('a signed context cannot confer another grant, account, session or endpoint', async () => {
      const own = await profile(); const before = await countPermissionEvents();
      const foreignContext = preferenceContext(subject, session, otherGrantId);
      await assert.rejects(service.portalCommunicationPreferences(subject, session, { input: { contextToken: foreignContext, choices: [] }, revision: 1, key: randomUUID() }), rejectedWith('COMMUNICATION_PROFILE_UNAVAILABLE'));
      await assert.rejects(save(own, [{ endpointId: otherEndpointId, purpose: 'request', allowed: true }]), rejectedWith('COMMUNICATION_PROFILE_UNAVAILABLE'));
      await assert.rejects(service.portalCommunicationPreferences(otherSubject, session, { input: { contextToken: own.contextToken, choices: [] }, revision: own.revision, key: randomUUID() }), rejectedWith('COMMUNICATION_CONTEXT_EXPIRED'));
      await assert.rejects(service.portalCommunicationPreferences(subject, 'sess_Other' + suffix, { input: { contextToken: own.contextToken, choices: [] }, revision: own.revision, key: randomUUID() }), rejectedWith('COMMUNICATION_CONTEXT_EXPIRED'));
      assert.equal(await countPermissionEvents(), before);
      assert.equal((await admin.query('SELECT count(*) AS count FROM communication_permission_events WHERE endpoint_id=$1', [otherEndpointId])).rows[0].count, '0');
    });
    await context.test('JSON null or non-string purposes and endpoints fail without a consent event', async () => {
      const value = await profile(); const before = await countPermissionEvents();
      for (const choice of [
        { endpointId: emailId, purpose: null, allowed: true },
        { endpointId: emailId, purpose: 1, allowed: true },
        { endpointId: null, purpose: 'request', allowed: true },
        { endpointId: emailId, purpose: 'request', allowed: null },
        { endpointId: emailId, purpose: 'request', allowed: 'true' },
      ]) await assert.rejects(service.portalCommunicationPreferences(subject, session, { input: { contextToken: value.contextToken, choices: [choice] }, revision: value.revision, key: randomUUID() }), rejectedWith('INVALID_COMMUNICATION_CHOICES'));
      assert.equal(await countPermissionEvents(), before);
      assert.equal((await profile()).revision, value.revision);
    });
    await context.test('a lost response replays one exact receipt and stale or repurposed commands cannot overwrite choices', async () => {
      const initial = await profile(), key = randomUUID(); const choices: Choice[] = [{ endpointId: emailId, purpose: 'request', allowed: true }];
      const saved = (await save(initial, choices, key)).profiles[0] as Profile;
      const replay = (await save(initial, choices, key)).profiles[0] as Profile;
      assert.equal(saved.revision > initial.revision, true); assert.equal(replay.revision, saved.revision);
      assert.deepEqual(replay.endpoints, saved.endpoints);
      assert.equal((await admin.query("SELECT count(*) AS count FROM communication_permission_events WHERE endpoint_id=$1 AND purpose='request' AND source='patient_portal'", [emailId])).rows[0].count, '1');
      await assert.rejects(save(initial, [{ endpointId: emailId, purpose: 'request', allowed: false }], key), rejectedWith('IDEMPOTENCY_KEY_REUSED'));
      await assert.rejects(save(initial, [{ endpointId: emailId, purpose: 'reminder', allowed: true }]), rejectedWith('REVISION_CONFLICT'));
      assert.equal((await profile()).endpoints.find(endpoint => endpoint.id === emailId)!.choices.request, true);
    });
    await context.test('two concurrent writes to one profile admit one revision and preserve the losing draft', async () => {
      const initial = await profile(); const before = await countPermissionEvents();
      const results = await Promise.allSettled([
        save(initial, [{ endpointId: emailId, purpose: 'request', allowed: false }]),
        save(initial, [{ endpointId: emailId, purpose: 'reminder', allowed: true }]),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
      assert.equal(rejectedWith('REVISION_CONFLICT')(rejected.reason), true);
      assert.equal(await countPermissionEvents(), before + 1);
      const current = await profile(); const email = current.endpoints.find(endpoint => endpoint.id === emailId)!;
      assert.equal(email.choices.request === false && email.choices.reminder === false || email.choices.request === true && email.choices.reminder === true, true);
    });
    await context.test('SMS paperwork permission is independent of both request consent and frozen email permission', async () => {
      const initial = await profile();
      assert.equal(initial.endpoints.find(endpoint => endpoint.id === emailId)!.paperworkEligible, false);
      assert.equal(initial.endpoints.find(endpoint => endpoint.id === smsId)!.paperworkEligible, true);
      const saved = (await save(initial, [{ endpointId: smsId, purpose: 'paperwork', allowed: true }])).profiles[0] as Profile;
      const sms = saved.endpoints.find(endpoint => endpoint.id === smsId)!;
      assert.deepEqual(sms.choices, { request: false, reminder: false, paperwork: true });
      await assert.rejects(save(saved, [{ endpointId: emailId, purpose: 'paperwork', allowed: true }]), rejectedWith('PAPERWORK_PERMISSION_UNAVAILABLE'));
      const grant = (await admin.query('SELECT paperwork_email_enabled,verified_email FROM patient_portal_grants WHERE id=$1', [grantId])).rows[0];
      assert.deepEqual(grant, { paperwork_email_enabled: false, verified_email: null });
    });
    await context.test('sender-wide suppression cannot be cleared by patient consent while withdrawal remains available', async () => {
      await admin.query("INSERT INTO destination_suppressions(practice_id,location_id,channel,provider_account,address_fingerprint,reason_code,source_event_id) VALUES($1,$2,'email',$3,$4,'BOUNCE',$5)", [otherPracticeId, otherLocationId, emailAccount, emailFingerprint, 'synthetic-bounce-' + suffix]);
      const initial = await profile(); assert.equal(initial.endpoints.find(endpoint => endpoint.id === emailId)!.suppressed, true);
      await assert.rejects(save(initial, [{ endpointId: emailId, purpose: 'request', allowed: true }]), rejectedWith('PROVIDER_OPTOUT_ACTIVE'));
      const saved = (await save(initial, [{ endpointId: emailId, purpose: 'request', allowed: false }])).profiles[0] as Profile;
      const endpoint = saved.endpoints.find(item => item.id === emailId)!; assert.equal(endpoint.suppressed, true); assert.equal(endpoint.choices.request, false);
      assert.equal((await admin.query('SELECT count(*) AS count FROM destination_suppressions WHERE provider_account=$1 AND address_fingerprint=$2', [emailAccount, emailFingerprint])).rows[0].count, '1');
    });
    await context.test('revoking the bound account removes profile visibility and prevents replay through its old context', async () => {
      const current = await profile();
      await admin.query("UPDATE patient_portal_grants SET revoked_at=now(),revocation_reason_code='synthetic_test_revocation',revision=revision+1 WHERE id=$1", [grantId]);
      assert.deepEqual((await service.portalCommunicationPreferences(subject, session)).profiles, []);
      await assert.rejects(save(current, [{ endpointId: smsId, purpose: 'paperwork', allowed: false }]), rejectedWith('COMMUNICATION_PROFILE_UNAVAILABLE'));
    });
  } finally {
    await runtime?.end();
    await admin.query(`DROP OWNED BY ${role}`).catch(() => {}); await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {}); await admin.end();
    for (const name of names) { if (previousEnvironment[name] === undefined) delete process.env[name]; else process.env[name] = previousEnvironment[name]; }
  }
});
