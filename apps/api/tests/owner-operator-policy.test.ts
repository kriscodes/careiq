import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  OWNER_OPERATOR_PERMISSIONS,
  applyOwnerOperatorPermissions,
  parseOwnerOperatorDisabledPermissions,
} from '../src/services/owner-operator-policy.js';
import { resolveEffectivePracticePermissions } from '../src/services/owner-operator-access.js';
import { AccessError, type CurrentMembership } from '../src/services/practice-policy.js';

const code = (value: string) => (error: unknown) =>
  error instanceof AccessError && error.code === value;
const practiceId = randomUUID(),
  userId = 'user_Owner123',
  orgId = 'org_Owner123';
function fixture() {
  const membership: CurrentMembership = {
    id: 'mem_Owner123',
    userId,
    role: 'org:admin',
    permissions: [],
  };
  const state = {
    context: { practice: practiceId, actor: userId },
    practice: {
      id: practiceId,
      orgId,
      ownerUserId: userId,
      authorizationMode: 'location',
      status: 'active',
    },
    enrollment: { membershipId: membership.id, status: 'active' } as
      | { membershipId: string; status: string }
      | undefined,
    account: undefined as { status: string } | undefined,
    profile: undefined as Record<string, unknown> | undefined,
    queries: [] as string[],
  };
  const client = {
    query: async (sql: string) => {
      state.queries.push(sql);
      const row = sql.includes('current_setting')
        ? state.context
        : sql.includes('FROM practices ')
          ? state.practice
          : sql.includes('FROM practice_member_access ')
            ? state.enrollment
            : sql.includes('FROM personal_account_lifecycle ')
              ? state.account
              : sql.includes('FROM practice_owner_access ')
                ? state.profile
                : assert.fail('Unexpected resolver query');
      return { rows: row ? [row] : [] };
    },
  } as unknown as PoolClient;
  return {
    state,
    membership,
    resolve: () =>
      resolveEffectivePracticePermissions(client, { practiceId, orgId, userId, membership }),
  };
}

test('owner preset contains exactly the reviewed operational grants and no protected audit or global grants', () => {
  assert.equal(OWNER_OPERATOR_PERMISSIONS.length, 17);
  assert.equal(new Set(OWNER_OPERATOR_PERMISSIONS).size, 17);
  assert.equal(
    OWNER_OPERATOR_PERMISSIONS.some((permission) => /audit|global|organization/.test(permission)),
    false,
  );
  assert.deepEqual(
    new Set(applyOwnerOperatorPermissions([], true)),
    new Set(OWNER_OPERATOR_PERMISSIONS),
  );
  const raw = ['org:appointments:read', 'org:audit:read'];
  assert.deepEqual(applyOwnerOperatorPermissions(raw, false, ['org:appointments:read']), raw);
  assert.deepEqual(raw, ['org:appointments:read', 'org:audit:read']);
  const restricted = applyOwnerOperatorPermissions(raw, true, ['org:appointments:read']);
  assert.equal(restricted.includes('org:appointments:read'), false);
  assert.equal(restricted.includes('org:audit:read'), true); // Existing explicit audit grants stay explicit.
});
test('owner restriction input rejects unknown keys, duplicate permissions and malformed arrays', () => {
  for (const input of [
    null,
    {},
    'org:patients:read',
    ['*'],
    ['org:audit:read'],
    ['org:patients:read', 'org:patients:read'],
    [true],
  ]) {
    assert.throws(() => parseOwnerOperatorDisabledPermissions(input), code('INVALID_OWNER_ACCESS'));
  }
  assert.deepEqual(parseOwnerOperatorDisabledPermissions(['org:patients:read']), [
    'org:patients:read',
  ]);
});
test('same-client verified owner defaults are complete and missing profile has no writes', async () => {
  const f = fixture(),
    result = await f.resolve();
  assert.equal(result.ownerOperator, true);
  assert.deepEqual(result.ownerAccess, {
    disabledPermissions: [],
    allLocations: true,
    revision: 0,
  });
  assert.deepEqual(new Set(result.permissions), new Set(OWNER_OPERATOR_PERMISSIONS));
  assert.equal(
    f.state.queries.some((sql) => /INSERT|UPDATE|DELETE|set_config/.test(sql)),
    false,
  );
});
test('saved owner denials override both defaults and provider grants without affecting recovery metadata', async () => {
  const f = fixture();
  f.membership.permissions = ['org:patients:read', 'org:paperwork:manage'];
  f.state.profile = {
    disabledPermissions: ['org:patients:read', 'org:paperwork:manage'],
    allLocations: false,
    revision: 7,
  };
  const result = await f.resolve();
  assert.equal(result.permissions.includes('org:patients:read'), false);
  assert.equal(result.permissions.includes('org:paperwork:manage'), false);
  assert.equal(result.ownerOperator, true);
  assert.equal(result.ownerAccess?.allLocations, false);
  assert.equal(result.ownerAccess?.revision, 7);
});
test('ordinary admins and a former owner retain only explicit provider grants, with current owner reread each time', async () => {
  const f = fixture();
  f.membership.permissions = ['org:documents:read'];
  assert.equal((await f.resolve()).permissions.includes('org:appointments:read'), true);
  f.state.practice.ownerUserId = 'user_NewOwner123';
  assert.deepEqual(await f.resolve(), {
    permissions: ['org:documents:read'],
    ownerOperator: false,
    ownerAccess: null,
  });
  const member = fixture();
  member.membership.role = 'org:member';
  assert.deepEqual(await member.resolve(), {
    permissions: [],
    ownerOperator: false,
    ownerAccess: null,
  });
});
test('resolver denies actor, practice, organization, enrollment and account mismatches', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.state.context.actor = 'user_Other123';
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.context.practice = randomUUID();
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.resolve(), code('AUTHORIZATION_CONTEXT_MISMATCH'));
    assert.equal(f.state.queries.length, 1);
  }
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.state.practice.orgId = 'org_Other';
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.practice.status = 'closed';
    },
    (f: ReturnType<typeof fixture>) => {
      f.state.practice.authorizationMode = 'legacy';
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.resolve(), code('PRACTICE_UNAVAILABLE'));
  }
  for (const status of ['pending_assignment', 'suspended', 'revoked']) {
    const f = fixture();
    f.state.enrollment!.status = status;
    await assert.rejects(f.resolve(), code('ENROLLMENT_REQUIRED'));
  }
  const missing = fixture();
  missing.state.enrollment = undefined;
  await assert.rejects(missing.resolve(), code('ENROLLMENT_REQUIRED'));
  const changed = fixture();
  changed.membership.id = 'mem_Rejoined';
  await assert.rejects(changed.resolve(), code('ENROLLMENT_REQUIRED'));
  const foreign = fixture();
  foreign.membership.userId = 'user_Other123';
  await assert.rejects(foreign.resolve(), code('ENROLLMENT_REQUIRED'));
  for (const status of ['archiving', 'archived', 'restoring']) {
    const f = fixture();
    f.state.account = { status };
    await assert.rejects(f.resolve(), code('ACCOUNT_ARCHIVED'));
  }
});
test('malformed stored owner profile fails closed instead of restoring full permissions', async () => {
  for (const profile of [
    { disabledPermissions: ['org:audit:read'], allLocations: true, revision: 1 },
    { disabledPermissions: [], allLocations: 'true', revision: 1 },
    { disabledPermissions: [], allLocations: true, revision: -1 },
  ]) {
    const f = fixture();
    f.state.profile = profile;
    await assert.rejects(f.resolve(), code('AUTHORIZATION_UNAVAILABLE'));
  }
});
