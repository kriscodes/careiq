import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationWorkerConfiguration, runNotificationWorkerTick } from '../src/notifications/worker.js';

const scope = { practiceId: '019a0000-0000-7000-8000-000000000001', locationId: '019a0000-0000-7000-8000-000000000002', orgId: 'org_synthetic', userId: 'user_synthetic', membershipId: 'orgmem_synthetic' };
test('notification worker is opt-in and rejects malformed or duplicate clinical scopes', () => {
    assert.equal(notificationWorkerConfiguration({}).enabled, false);
    assert.throws(() => notificationWorkerConfiguration({ CAREIQ_NOTIFICATION_WORKER_ENABLED: 'true' }), /SCOPES/);
    assert.throws(() => notificationWorkerConfiguration({ CAREIQ_NOTIFICATION_WORKER_ENABLED: 'true', CAREIQ_NOTIFICATION_WORKER_SCOPES: JSON.stringify([scope, scope]) }), /DUPLICATE/);
    assert.throws(() => notificationWorkerConfiguration({ CAREIQ_NOTIFICATION_WORKER_ENABLED: 'true', CAREIQ_NOTIFICATION_WORKER_SCOPES: JSON.stringify([{ ...scope, superuser: true }]) }), /SCOPES/);
});
test('stale membership or missing permission prevents either dispatcher from running', async () => {
    let calls = 0;
    const execute = async () => { calls++; };
    await assert.rejects(runNotificationWorkerTick([scope], { authorize: async () => ({ tenant: { ...scope, membershipId: 'replacement' }, permissions: ['org:requests:send', 'org:documents:read', 'org:appointments:read'] }), patient: execute, staff: execute }), /SCOPE_CHANGED/);
    await assert.rejects(runNotificationWorkerTick([scope], { authorize: async () => ({ tenant: scope, permissions: ['org:appointments:read'] }), patient: execute, staff: execute }), /PERMISSION_REQUIRED/);
    assert.equal(calls, 0);
    await runNotificationWorkerTick([scope], { authorize: async () => ({ tenant: scope, permissions: ['org:requests:send', 'org:documents:read', 'org:appointments:read'] }), patient: execute, staff: execute });
    assert.equal(calls, 2);
});

test('one revoked scope or failed channel cannot starve later authorized work', async () => {
    const next = { ...scope, locationId: '019a0000-0000-7000-8000-000000000003' };
    const calls: string[] = [];
    const permissions = ['org:requests:send', 'org:documents:read', 'org:appointments:read'];
    await assert.rejects(runNotificationWorkerTick([scope, next], {
        authorize: async (_, locationId) => { if (locationId === scope.locationId) throw new Error('revoked'); return { tenant: next, permissions }; },
        patient: async t => { calls.push('patient:' + t.locationId); throw new Error('provider deferred'); },
        staff: async t => { calls.push('staff:' + t.locationId); },
    }), /DEFERRED/);
    assert.deepEqual(calls, ['patient:' + next.locationId, 'staff:' + next.locationId]);
});
