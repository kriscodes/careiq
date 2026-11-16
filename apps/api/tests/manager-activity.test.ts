import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { isolatedTestDatabaseUrl } from './local-test-database.js';
import { managerActivityFilters } from '../src/workflow/manager-activity-policy.js';
import { WorkflowError } from '../src/workflow/policy.js';

test('manager activity validates bounded dates and typed actor/category filters', () => {
  assert.deepEqual(managerActivityFilters({ from: '2026-11-01', to: '2026-11-01' }), {
    from: '2026-11-01',
    to: '2026-11-01',
    limit: 50,
    category: 'all',
  });
  for (const patch of [
    { actorId: ['forged'] },
    { actorId: '' },
    { category: ['insurance'] },
    { category: 'audit' },
    { practiceId: randomUUID() },
    { from: '2026-02-30' },
    { to: '2026-12-02' },
  ]) {
    assert.throws(
      () => managerActivityFilters({ from: '2026-11-01', to: '2026-11-01', ...patch }),
      WorkflowError,
    );
  }
});

const url = isolatedTestDatabaseUrl();
test(
  'manager activity counts canonical actions by local action day, preserves former actors and safely paginates',
  { skip: !url },
  async () => {
    const admin = new Pool({ connectionString: url, ssl: false });
    const suffix = randomBytes(6).toString('hex'),
      role = 'careiq_manager_test_' + suffix,
      password = randomBytes(24).toString('hex');
    const practiceId = randomUUID(),
      locationId = randomUUID(),
      otherLocationId = randomUUID();
    const userId = 'synthetic_manager_' + suffix,
      formerId = 'synthetic_former_' + suffix,
      membershipId = 'membership_' + suffix;
    const tenant = { practiceId, locationId, userId, membershipId, orgId: 'org_' + practiceId };
    const old = { url: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL_MODE };
    let runtimePool: Pool | undefined;
    const expected = new Set<string>();
    try {
      await admin.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
      );
      await admin.query(`GRANT careiq_clinical_runtime TO ${role}`);
      await admin.query(
        "INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic manager activity','location','active')",
        [practiceId, tenant.orgId],
      );
      await admin.query(
        "INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic A','America/Los_Angeles'),($2,$3,'Synthetic B','America/Los_Angeles')",
        [locationId, otherLocationId, practiceId],
      );
      await admin.query(
        "INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,$3,'active'),($1,$4,$5,'suspended')",
        [practiceId, userId, membershipId, formerId, 'former_' + suffix],
      );
      await admin.query(
        'INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)',
        [practiceId, userId, locationId],
      );
      const emit = async (
        action: string,
        time: string,
        options: {
          actor?: string;
          actorType?: string;
          outcome?: string;
          location?: string;
          metadata?: Record<string, unknown>;
        } = {},
      ) => {
        const eventId = randomUUID();
        await admin.query(
          "INSERT INTO audit.events(id,recorded_at,scope_kind,practice_id,location_id,actor_type,actor_id,action,entity_type,entity_id,outcome,transaction_id,reason_code,metadata) VALUES($1,$2,'location',$3,$4,$5,$6,$7,'synthetic', $8,$9,$10,'PRIVATE_REASON',$11)",
          [
            eventId,
            time,
            practiceId,
            options.location ?? locationId,
            options.actorType ?? 'user',
            options.actor ?? userId,
            action,
            randomUUID(),
            options.outcome ?? 'succeeded',
            randomUUID(),
            JSON.stringify({ purpose: 'PRIVATE_METADATA', ...options.metadata }),
          ],
        );
        return eventId;
      };
      expected.add(
        await emit('appointments.create', '2026-11-01T07:00:00.123001Z', {
          metadata: { resultState: 'scheduled' },
        }),
      );
      await emit('appointments.create.details', '2026-11-01T07:00:00.123002Z');
      expected.add(
        await emit('insurance.evidence.recorded', '2026-11-01T08:30:00Z', {
          actor: formerId,
          metadata: { toState: 'inactive', channel: 'phone' },
        }),
      );
      expected.add(
        await emit('insurance.evidence.corrected', '2026-11-01T09:30:00Z', {
          actor: formerId,
          metadata: { toState: 'active', channel: 'document' },
        }),
      );
      expected.add(await emit('insurance.follow_up.revised', '2026-11-02T07:59:59.999999Z'));
      expected.add(
        await emit('work-items.completion', '2026-11-01T11:00:00.123001Z', {
          metadata: { resultState: 'completed' },
        }),
      );
      expected.add(
        await emit('requests.reminders', '2026-11-01T11:00:00.123002Z', {
          metadata: { resultState: 'open' },
        }),
      );
      for (const action of [
        'manager.activity.read',
        'appointments.create.accepted',
        'appointments.create.replay',
      ]) {
        await emit(action, '2026-11-01T10:00:00Z');
      }
      await emit('appointments.create', '2026-11-01T06:59:59.999999Z');
      await emit('appointments.create', '2026-11-02T08:00:00Z');
      await emit('appointments.create', '2026-11-01T10:00:00Z', { location: otherLocationId });
      await emit('appointments.create', '2026-11-01T10:00:00Z', { outcome: 'denied' });
      await emit('appointments.create', '2026-11-01T10:00:00Z', { actorType: 'background_job' });
      const runtimeUrl = new URL(url!);
      runtimeUrl.username = role;
      runtimeUrl.password = password;
      process.env.DATABASE_URL = runtimeUrl.href;
      process.env.DATABASE_SSL_MODE = 'disable';
      const { managerActivity } = await import('../src/services/manager-activity.service.js');
      ({ pool: runtimePool } = await import('../src/db/client.js'));
      const filters = managerActivityFilters({ from: '2026-11-01', to: '2026-11-01', limit: '2' });
      let response = await managerActivity(tenant, filters, randomUUID());
      assert.deepEqual(response.summary, { total: 6, appointments: 1, insurance: 2, followups: 3 });
      assert.equal(response.timeZone, 'America/Los_Angeles');
      assert.deepEqual(
        new Set(response.actors.map((actor) => actor.id)),
        new Set([userId, formerId]),
      );
      const events = [...response.items];
      const readEvent = (
        await admin.query(
          "SELECT id FROM audit.events WHERE practice_id=$1 AND action='manager.activity.read' ORDER BY recorded_at DESC,id DESC LIMIT 1",
          [practiceId],
        )
      ).rows[0];
      const disclosed = (
        await admin.query(
          'SELECT resource_type,resource_id FROM audit.event_resources WHERE event_id=$1',
          [readEvent.id],
        )
      ).rows;
      assert.deepEqual(
        new Set(disclosed.map((row) => row.resource_id)),
        new Set(response.items.map((item) => item.entityId)),
      );
      assert.deepEqual(
        new Set(disclosed.map((row) => row.resource_type)),
        new Set(['insurance_case', 'request']),
      );
      const originalCursor = response.pagination.nextCursor!;
      while (response.pagination.hasMore) {
        response = await managerActivity(
          tenant,
          { ...filters, cursor: response.pagination.nextCursor! },
          randomUUID(),
        );
        assert.equal(response.summary.total, 6);
        events.push(...response.items);
      }
      assert.equal(events.length, expected.size);
      assert.deepEqual(new Set(events.map((event) => event.id)), expected);
      assert.equal(JSON.stringify(events).includes('PRIVATE_'), false);
      const historical = events.filter((event) => event.actorId === formerId);
      assert.deepEqual(
        historical.map((event) => [event.result, event.source]),
        [
          ['active', 'document'],
          ['inactive', 'phone'],
        ],
      );
      const selected = await managerActivity(
        tenant,
        { ...filters, actorId: formerId, category: 'insurance' },
        randomUUID(),
      );
      assert.deepEqual(selected.summary, { total: 2, appointments: 0, insurance: 2, followups: 0 });
      assert.equal(selected.actors.length, 2);
      const empty = await managerActivity(
        tenant,
        { ...filters, actorId: 'unknown_historical_actor' },
        randomUUID(),
      );
      assert.equal(empty.summary.total, 0);
      assert.equal(empty.items.length, 0);
      assert.equal(empty.actors.length, 2);
      for (const changed of [
        { ...filters, category: 'insurance' as const },
        { ...filters, actorId: formerId },
        { ...filters, limit: 3 },
        { ...filters, from: '2026-10-31' },
      ]) {
        await assert.rejects(
          managerActivity(tenant, { ...changed, cursor: originalCursor }, randomUUID()),
          (error) => error instanceof WorkflowError && error.code === 'INVALID_CURSOR',
        );
      }
      await assert.rejects(
        managerActivity(
          { ...tenant, userId: formerId },
          { ...filters, cursor: originalCursor },
          randomUUID(),
        ),
        (error) => error instanceof WorkflowError && error.code === 'INVALID_CURSOR',
      );
      await assert.rejects(
        managerActivity({ ...tenant, locationId: otherLocationId }, filters, randomUUID()),
        (error) => error instanceof WorkflowError && error.status === 403,
      );
      await assert.rejects(
        runtimePool.query('SELECT * FROM audit.events'),
        (error) => (error as { code?: string }).code === '42501',
      );
      const { verifyInsuranceDatabaseRelease } =
        await import('../src/db/insurance-release-check.js');
      await verifyInsuranceDatabaseRelease(runtimePool);
      await admin.query('UPDATE location_assignments SET active=false WHERE practice_id=$1', [
        practiceId,
      ]);
      await assert.rejects(
        managerActivity(tenant, filters, randomUUID()),
        (error) => error instanceof WorkflowError && error.status === 403,
      );
    } finally {
      await runtimePool?.end();
      await admin.query(`DROP OWNED BY ${role}`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
      await admin.query('DELETE FROM location_assignments WHERE practice_id=$1', [practiceId]);
      await admin.query('DELETE FROM practice_member_access WHERE practice_id=$1', [practiceId]);
      await admin.query('DELETE FROM locations WHERE practice_id=$1', [practiceId]);
      await admin.query('DELETE FROM practices WHERE id=$1', [practiceId]);
      await admin.end();
      if (old.url === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = old.url;
      }
      if (old.ssl === undefined) {
        delete process.env.DATABASE_SSL_MODE;
      } else {
        process.env.DATABASE_SSL_MODE = old.ssl;
      }
    }
  },
);
