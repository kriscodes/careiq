import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canEnterApplication,
  canOpenWorkspaceView,
  preferredWorkspaceView,
  hasWorkspacePermission,
  resolveWorkspaceScope,
  type AccessContext,
  type WorkspaceCapabilities,
  type WorkspaceView,
} from '../src/lib/api/practice';
import { NO_CAPABILITIES } from '../src/lib/capabilities';
const location = '11111111-1111-4111-8111-111111111111';
const views: readonly WorkspaceView[] = [
  'Today',
  'Schedule',
  'Patients',
  'Documents',
  'Templates',
  'Manager',
  'Insurance',
  'Communications',
  'Notifications',
];
const denied: WorkspaceCapabilities = {
  patientsRead: false,
  appointmentsRead: false,
  documentsRead: false,
  configurationManage: false,
};
const context = (): AccessContext => ({
  userId: 'synthetic-user',
  orgId: 'synthetic-org',
  practice: {
    id: 'synthetic-practice',
    name: 'Synthetic practice',
    authorizationMode: 'location',
    status: 'active',
  },
  onboarding: 'ready',
  enrollmentStatus: 'active',
  capabilities: NO_CAPABILITIES,
  workspaceCapabilities: denied,
  management: { locations: true, members: true },
  locations: [{ id: location, name: 'Assigned location', timeZone: 'UTC', status: 'active' }],
});

test('ownership and an assignment never substitute for workspace read permission', () => {
  assert.equal(hasWorkspacePermission(context()), false);
  assert.deepEqual(resolveWorkspaceScope(context(), location), { kind: 'blocked' });
});
for (const capability of Object.keys(denied) as Array<keyof WorkspaceCapabilities>) {
  test(`${capability} alone admits an active assigned workspace`, () => {
    const value = { ...context(), workspaceCapabilities: { ...denied, [capability]: true } };
    assert.equal(hasWorkspacePermission(value), true);
    assert.deepEqual(resolveWorkspaceScope(value, location), {
      kind: 'location',
      locationId: location,
    });
    assert.deepEqual(resolveWorkspaceScope({ ...value, locations: [] }, location), {
      kind: 'blocked',
    });
    assert.deepEqual(resolveWorkspaceScope({ ...value, enrollmentStatus: 'suspended' }, location), {
      kind: 'blocked',
    });
  });
}
test('explicit full capability replies override old patient/appointment navigation hints', () => {
  const value = {
    ...context(),
    capabilities: {
      patients: { read: true, create: true },
      appointments: { read: true, create: true },
    },
  };
  assert.equal(hasWorkspacePermission(value), false);
  delete value.workspaceCapabilities;
  assert.equal(hasWorkspacePermission(value), true);
});
test('malformed full capability fields cannot grant entry', () => {
  for (const malformed of [null, {}, { documentsRead: 'true' }, { configurationManage: 1 }]) {
    assert.equal(
      hasWorkspacePermission({
        ...context(),
        workspaceCapabilities: malformed as unknown as WorkspaceCapabilities,
      }),
      false,
    );
  }
});
test('a valid legacy read context opens only after an explicit navigation decision', () => {
  const value = context();
  value.practice!.authorizationMode = 'legacy';
  value.enrollmentStatus = null;
  value.workspaceCapabilities = { ...denied, patientsRead: true };
  assert.deepEqual(resolveWorkspaceScope(value, ''), { kind: 'legacy' });
  assert.deepEqual(resolveWorkspaceScope({ ...value, onboarding: 'pending' }, ''), {
    kind: 'blocked',
  });
});

test('active owners and members enter the application without requiring clinical grants or assigned locations', () => {
  for (const owner of [true, false]) {
    const value = { ...context(), management: { locations: owner, members: owner }, locations: [] };
    assert.equal(canEnterApplication(value), true);
    assert.equal(preferredWorkspaceView(value), null);
    for (const view of views) {
      assert.equal(canOpenWorkspaceView(value, view), false);
    }
    assert.equal(hasWorkspacePermission(value), false);
    assert.deepEqual(resolveWorkspaceScope(value, location), { kind: 'blocked' });
  }
});

test('application entry rejects missing practice context and inactive membership without inferring access from ownership', () => {
  const valid = context();
  const invalid: AccessContext[] = [
    { ...valid, orgId: null },
    { ...valid, orgId: '' },
    { ...valid, orgId: '   ' },
    { ...valid, orgId: ' org_test ' },
    { ...valid, practice: null },
    { ...valid, onboarding: 'required' },
    { ...valid, onboarding: 'pending' },
    ...['pending', 'suspended', 'closed'].map((status) => ({
      ...valid,
      practice: { ...valid.practice!, status },
    })),
    ...[null, 'pending_assignment', 'suspended', 'revoked'].map((enrollmentStatus) => ({
      ...valid,
      enrollmentStatus,
    })),
    { ...valid, practice: { ...valid.practice!, authorizationMode: 'unknown' as 'location' } },
  ];
  for (const value of invalid) {
    assert.equal(canEnterApplication(value), false);
    assert.equal(preferredWorkspaceView(value), null);
    for (const view of views) {
      assert.equal(canOpenWorkspaceView(value, view), false);
    }
  }
});

test('every capability combination selects only permitted destinations with an accurate first view', () => {
  for (let mask = 0; mask < 16; mask++) {
    const caps = {
      patientsRead: Boolean(mask & 1),
      appointmentsRead: Boolean(mask & 2),
      documentsRead: Boolean(mask & 4),
      configurationManage: Boolean(mask & 8),
    };
    const value = { ...context(), workspaceCapabilities: caps };
    const expected = [
      caps.appointmentsRead,
      caps.appointmentsRead,
      caps.patientsRead,
      caps.documentsRead,
      caps.documentsRead || caps.configurationManage,
      caps.patientsRead && caps.appointmentsRead,
      caps.patientsRead && caps.appointmentsRead,
      caps.patientsRead && caps.documentsRead,
      caps.appointmentsRead,
    ];
    assert.deepEqual(
      views.map((view) => canOpenWorkspaceView(value, view)),
      expected,
      `capability combination ${mask}`,
    );
    assert.equal(
      preferredWorkspaceView(value),
      caps.appointmentsRead
        ? 'Today'
        : caps.patientsRead
          ? 'Patients'
          : caps.documentsRead
            ? 'Documents'
            : caps.configurationManage
              ? 'Templates'
              : null,
    );
    for (const invalid of [
      { ...value, enrollmentStatus: 'suspended' },
      { ...value, practice: { ...value.practice!, status: 'suspended' } },
    ]) {
      assert.equal(preferredWorkspaceView(invalid), null);
      assert.ok(views.every((view) => !canOpenWorkspaceView(invalid, view)));
    }
  }
});

test('explicit false or malformed workflow capabilities never fall back to broader old hints', () => {
  const value = {
    ...context(),
    capabilities: {
      patients: { read: true, create: true },
      appointments: { read: true, create: true },
    },
  };
  for (const malformed of [
    null,
    {},
    denied,
    { patientsRead: 'true', appointmentsRead: 1 },
    { documentsRead: 'true', configurationManage: 'true' },
  ]) {
    const explicit = {
      ...value,
      workspaceCapabilities: malformed as unknown as WorkspaceCapabilities,
    };
    assert.equal(canEnterApplication(explicit), true);
    assert.equal(preferredWorkspaceView(explicit), null);
    for (const view of views) {
      assert.equal(canOpenWorkspaceView(explicit, view), false);
    }
  }
  assert.equal(canOpenWorkspaceView(value, 'Unknown' as WorkspaceView), false);
});

test('legacy fallback preserves original patient and appointment reads without inventing document or template access', () => {
  const value = context();
  value.practice!.authorizationMode = 'legacy';
  value.enrollmentStatus = null;
  delete value.workspaceCapabilities;
  assert.equal(canEnterApplication(value), true);
  assert.equal(preferredWorkspaceView(value), null);
  value.capabilities = {
    patients: { read: true, create: true },
    appointments: { read: false, create: true },
  };
  assert.equal(preferredWorkspaceView(value), 'Patients');
  assert.equal(canOpenWorkspaceView(value, 'Today'), false);
  value.capabilities.appointments.read = true;
  assert.equal(preferredWorkspaceView(value), 'Today');
  assert.equal(canOpenWorkspaceView(value, 'Documents'), false);
  assert.equal(canOpenWorkspaceView(value, 'Templates'), false);
  for (const view of ['Manager', 'Insurance', 'Communications', 'Notifications'] as const) {
    assert.equal(canOpenWorkspaceView(value, view), false);
  }
  value.workspaceCapabilities = {
    patientsRead: true,
    appointmentsRead: true,
    documentsRead: true,
    configurationManage: true,
  };
  for (const view of ['Manager', 'Insurance', 'Communications', 'Notifications'] as const) {
    assert.equal(canOpenWorkspaceView(value, view), false);
  }
  assert.deepEqual(resolveWorkspaceScope(value, ''), { kind: 'legacy' });
});

test('clinical navigation can be available before location choice while record access stays blocked until a valid assignment', () => {
  const value: AccessContext = {
    ...context(),
    workspaceCapabilities: { ...denied, patientsRead: true },
    locations: [],
  };
  assert.equal(canEnterApplication(value), true);
  assert.equal(canOpenWorkspaceView(value, 'Patients'), true);
  assert.equal(preferredWorkspaceView(value), 'Patients');
  assert.deepEqual(resolveWorkspaceScope(value, location), { kind: 'blocked' });
  value.locations = [
    { id: location, name: 'Assigned location', timeZone: 'UTC', status: 'active' },
  ];
  assert.deepEqual(resolveWorkspaceScope(value, location), {
    kind: 'location',
    locationId: location,
  });
});
