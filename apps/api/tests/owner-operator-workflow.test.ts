import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workflowCapabilities } from '../src/routes/workflow.js';
import {
  OWNER_OPERATOR_PERMISSIONS,
  applyOwnerOperatorPermissions,
} from '../src/services/owner-operator-policy.js';
import type { RequestAuthentication } from '../src/middleware/tenant-context.js';
const auth = {
  isAuthenticated: true,
  userId: 'user_Owner123',
  orgId: 'org_Owner123',
  orgRole: 'org:admin',
  has: () => false,
} as RequestAuthentication;
test('only a verified current owner may use effective paperwork authority without a provider-token grant', () => {
  assert.equal(
    workflowCapabilities(auth, {}, [...OWNER_OPERATOR_PERMISSIONS]).paperworkManage,
    false,
  );
  assert.equal(
    workflowCapabilities(auth, {}, [...OWNER_OPERATOR_PERMISSIONS], true).paperworkManage,
    true,
  );
  for (const disabled of ['org:paperwork:manage', 'org:workflow:configure', 'org:documents:read']) {
    const effective = applyOwnerOperatorPermissions([...OWNER_OPERATOR_PERMISSIONS], true, [
      disabled,
    ]);
    assert.equal(
      workflowCapabilities({ ...auth, has: () => true }, {}, effective, true).paperworkManage,
      false,
    );
  }
});
test('ordinary dedicated permission keeps its existing session-plus-current-scope checks', () => {
  const staff = { ...auth, has: () => true };
  assert.equal(
    workflowCapabilities(staff, {}, ['org:workflow:configure', 'org:documents:read'])
      .paperworkManage,
    true,
  );
  assert.equal(workflowCapabilities(staff, {}, ['org:documents:read']).paperworkManage, false);
  assert.equal(workflowCapabilities(staff, {}, ['org:workflow:configure']).paperworkManage, false);
});
