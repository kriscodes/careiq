import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferenceContext,preferenceGrant} from '../src/notifications/portal-preference-policy.js';
const grant = '019a0000-0000-7000-8000-000000000001';
test('communication context is bound to the verified account, session, grant and expiry', () => {
    const now = 1792365846000, token = preferenceContext('user_one','sess_one',grant,now);
    assert.equal(preferenceGrant(token,'user_one','sess_one',now),grant);
    assert.throws(() => preferenceGrant(token,'user_two','sess_one',now),/COMMUNICATION_CONTEXT_EXPIRED/);
    assert.throws(() => preferenceGrant(token,'user_one','sess_two',now),/COMMUNICATION_CONTEXT_EXPIRED/);
    assert.throws(() => preferenceGrant(token,'user_one','sess_one',now+600000),/COMMUNICATION_CONTEXT_EXPIRED/);
    assert.throws(() => preferenceGrant(token+'x','user_one','sess_one',now),/COMMUNICATION_CONTEXT_EXPIRED/);
    for (const value of [null, 'invalid', token + '.extra', 'x'.repeat(1201)]) assert.throws(() => preferenceGrant(value,'user_one','sess_one',now),/COMMUNICATION_CONTEXT_EXPIRED/);
});
