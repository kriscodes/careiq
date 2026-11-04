import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAvailabilityDatabaseRelease } from '../src/db/availability-release-check.js';

const reviewedBody = /AS\s+\$\$([\s\S]*?)\$\$;/.exec(
  readFileSync(new URL('../drizzle/0046_provider_availability_busy.sql', import.meta.url), 'utf8'),
)?.[1];
const safe = () => ({
  prosecdef: true,
  proconfig: ['search_path=pg_catalog, public, pg_temp'],
  prosrc: reviewedBody,
  proretset: false,
  boolean_result: true,
  owns: false,
  expected_owner: true,
  owner_privileged: false,
  owner_inherits: false,
  runtime_member: false,
  owner_can_create: false,
  can_execute: true,
  runtime_execute: true,
  public_execute: false,
});
const policy = () => ({
  permissive: 'PERMISSIVE',
  cmd: 'SELECT',
  roles: ['careiq_availability_reader'],
  qual: "(practice_id = careiq_context_uuid('app.practice_id'::text))",
  with_check: null,
});
const projection = {
  practices: ['id', 'status', 'authorization_mode'],
  practice_member_access: ['practice_id', 'user_id', 'status'],
  location_assignments: ['practice_id', 'user_id', 'location_id', 'active'],
  locations: ['id', 'practice_id', 'status'],
  providers: ['id', 'practice_id', 'status'],
  provider_locations: ['practice_id', 'provider_id', 'location_id', 'active'],
  appointments: [
    'id',
    'practice_id',
    'location_id',
    'provider_id',
    'status',
    'scheduled_at',
    'ends_at',
  ],
};
const columns = () =>
  Object.entries(projection).flatMap(([relname, names]) =>
    names.map((attname) => ({
      nspname: 'public',
      relname,
      attname,
      can_select: true,
      excessive: false,
      table_privilege: false,
      owns: false,
    })),
  );
const fixture = (
  rows: Record<string, unknown>[] = [safe()],
  policies: Record<string, unknown>[] = [policy()],
  grants = columns(),
) =>
  ({
    query: async (sql: string) => ({
      rows: sql.includes('availability_projection_policy')
        ? policies
        : sql.includes('availability_projection_columns')
          ? grants
          : rows,
    }),
  }) as never;

test('availability release accepts only the reviewed private-reader boolean helper', async () => {
  await verifyAvailabilityDatabaseRelease(fixture());
});
test('availability release rejects missing, changed, public, privileged-owner and broader-return helpers', async () => {
  await assert.rejects(verifyAvailabilityDatabaseRelease(fixture([])), /boolean boundary/);
  await assert.rejects(
    verifyAvailabilityDatabaseRelease(fixture([safe(), safe()])),
    /boolean boundary/,
  );
  for (const change of [
    { prosecdef: false },
    { proconfig: null },
    { prosrc: 'RETURN false;' },
    { proretset: true },
    { boolean_result: false },
    { owns: true },
    { expected_owner: false },
    { owner_privileged: true },
    { owner_inherits: true },
    { runtime_member: true },
    { owner_can_create: true },
    { can_execute: false },
    { runtime_execute: false },
    { public_execute: true },
  ]) {
    await assert.rejects(
      verifyAvailabilityDatabaseRelease(fixture([{ ...safe(), ...change }])),
      /boolean boundary/,
      JSON.stringify(change),
    );
  }
});
test('availability release rejects widened policies and reader access to patient identifiers', async () => {
  for (const change of [
    { permissive: 'RESTRICTIVE' },
    { cmd: 'ALL' },
    { roles: ['public'] },
    { qual: 'true' },
    { with_check: 'true' },
  ]) {
    await assert.rejects(
      verifyAvailabilityDatabaseRelease(fixture([safe()], [{ ...policy(), ...change }])),
      /projection policy/,
    );
  }
  await assert.rejects(
    verifyAvailabilityDatabaseRelease(fixture([safe()], [])),
    /projection policy/,
  );
  await assert.rejects(
    verifyAvailabilityDatabaseRelease(fixture([safe()], [policy()], columns().slice(1))),
    /reader grants/,
  );
  for (const change of [
    { can_select: true },
    { excessive: true },
    { table_privilege: true },
    { owns: true },
  ]) {
    const grants = [
      ...columns(),
      {
        nspname: 'public',
        relname: 'appointments',
        attname: 'patient_id',
        can_select: false,
        excessive: false,
        table_privilege: false,
        owns: false,
        ...change,
      },
    ];
    await assert.rejects(
      verifyAvailabilityDatabaseRelease(fixture([safe()], [policy()], grants)),
      /reader grants/,
    );
  }
});
