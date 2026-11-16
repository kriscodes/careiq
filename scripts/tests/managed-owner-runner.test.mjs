import test from 'node:test';
import assert from 'node:assert/strict';
import { assertManagedOwnership } from '../test-managed-owner.mjs';

const owner = {
  rolname: 'careiq_managed_owner',
  rolsuper: false,
  rolbypassrls: false,
  rolcreatedb: true,
  rolcreaterole: true,
};
test('managed-owner gate rejects privileged migrators and incomplete ownership evidence', () => {
  const relations = [{ owner: owner.rolname }];
  assert.doesNotThrow(() => assertManagedOwnership(owner, relations));
  for (const property of ['rolsuper', 'rolbypassrls']) {
    assert.throws(() => assertManagedOwnership({ ...owner, [property]: true }, relations));
  }
  assert.throws(() => assertManagedOwnership(owner, []));
  assert.throws(() => assertManagedOwnership(owner, [{ owner: 'postgres' }]));
  assert.throws(() => assertManagedOwnership(undefined, relations));
});
