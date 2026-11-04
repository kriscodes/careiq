import type { Page, Route } from '@playwright/test';
import { test, expect } from './harness';

const main = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetic main location',
  timeZone: 'UTC',
  status: 'active',
};
const second = {
  ...main,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Synthetic second location',
};
const closed = {
  ...main,
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Synthetic closed location',
  status: 'closed',
};
const profile = { disabledPermissions: [] as string[], allLocations: true, revision: 0 };
const owner = {
  userId: 'user_test',
  membershipId: 'membership_owner',
  displayName: 'Synthetic owner',
  email: 'owner@example.invalid',
  isOwner: true,
  role: 'org:admin',
  status: 'active',
  locationIds: [main.id],
};
const admin = {
  locations: [main, second, closed],
  members: [owner],
  invitations: [],
  allowedRoles: ['org:member', 'org:admin'],
  ownerAccess: profile,
};
const context = {
  userId: owner.userId,
  orgId: 'org_test',
  practice: {
    id: 'practice_test',
    name: 'Synthetic practice',
    authorizationMode: 'location',
    status: 'active',
  },
  onboarding: 'ready',
  enrollmentStatus: 'active',
  capabilities: {
    patients: { read: true, create: true },
    appointments: { read: true, create: true },
  },
  workspaceCapabilities: {
    patientsRead: true,
    appointmentsRead: true,
    documentsRead: true,
    configurationManage: true,
  },
  management: { locations: true, members: true },
  locations: [main, second],
  ownerAccess: profile,
};
const permissions = [
  'org:patients:read',
  'org:patients:create',
  'org:patients:update',
  'org:appointments:read',
  'org:appointments:create',
  'org:appointments:update',
  'org:documents:read',
  'org:documents:upload',
  'org:documents:review',
  'org:documents:archive',
  'org:requests:send',
  'org:requirements:waive',
  'org:requirements:manage',
  'org:work:manage',
  'org:activity:read',
  'org:workflow:configure',
  'org:paperwork:manage',
].sort();
const areaNames = [
  'Patients',
  'Appointments',
  'Documents & Requests',
  'Work & Activity',
  'Templates & Setup',
  'Patient Account Access',
];
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
const area = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
const save = (page: Page) => page.getByRole('button', { name: 'Save My Access', exact: true });
const home = (page: Page) => page.getByRole('heading', { name: 'Hello again.', exact: true });
async function open(
  page: Page,
  harnessUrl: string,
  respond?: (route: Route) => Promise<void>,
  current: () => unknown = () => context,
) {
  await page.route('**/api/v1/**', (route) =>
    new URL(route.request().url()).pathname === '/api/v1/me'
      ? json(route, { data: current() })
      : respond
        ? respond(route)
        : json(route, { data: admin }),
  );
  await page.goto(`${harnessUrl}/?component=workspace`);
  await page.getByRole('button', { name: 'My Workspace Access', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'My Workspace Access', exact: true }),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

test('authoritative operator defaults show six enabled areas and all active locations without changing the role', async ({
  page,
  harnessUrl,
}) => {
  const writes: { path: string; body: unknown }[] = [];
  await open(page, harnessUrl, (route) => {
    if (route.request().method() === 'POST') {
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
      return json(route, { data: profile });
    }
    return json(route, { data: admin });
  });
  for (const name of areaNames) {
    await expect(area(page, name)).toBeChecked();
  }
  await expect(area(page, 'All Current And Future Locations')).toBeChecked();
  for (const location of [main, second]) {
    const checkbox = area(page, location.name);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeDisabled();
  }
  await expect(page.getByText(closed.name, { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
  await save(page).click();
  await expect(home(page)).toBeVisible();
  expect(writes).toEqual([
    {
      path: '/api/v1/practice/owner-access',
      body: { disabledPermissions: [], allLocations: true, locationIds: [], revision: 0 },
    },
  ]);
});

test('a default owner opens the real Patients, Documents and Templates workspace without forbidden reads', async ({
  page,
  harnessUrl,
}) => {
  const paths: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path === '/api/v1/me') {
      return json(route, { data: { ...context, locations: [main] } });
    }
    if (path === `/api/v1/locations/${main.id}/workflow`) {
      return json(route, {
        data: {
          location: main,
          timeZone: 'UTC',
          patients: [],
          appointments: [],
          documents: [],
          templates: [],
          requests: [],
          workItems: [],
          providers: [],
          visitTypes: [],
          documentTypes: [],
          capabilities: {
            patientsRead: true,
            patientsCreate: true,
            patientsUpdate: true,
            appointmentsRead: true,
            appointmentsCreate: true,
            appointmentsUpdate: true,
            documentsRead: true,
            documentsUpload: true,
            documentsReview: true,
            documentsArchive: true,
            requestsSend: true,
            requirementsWaive: true,
            requirementsManage: true,
            workManage: true,
            activityRead: true,
            configurationManage: true,
            paperworkManage: true,
          },
          asOf: '2026-10-31T12:00:00Z',
        },
      });
    }
    if (path.endsWith('/notifications')) {
      return json(route, { data: [], unreadCount: 0 });
    }
    throw new Error(`Unexpected owner workspace request: ${path}`);
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  expect(paths).toEqual(['/api/v1/me']);
  await page.getByRole('button', { name: 'Open Workspace', exact: true }).click();
  await page.getByRole('button', { name: /^Continue/ }).click();
  const nav = page.getByRole('navigation', { name: 'Practice Navigation', exact: true });
  for (const view of ['Patients', 'Documents', 'Templates']) {
    const button = nav.getByRole('button', { name: view, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  expect(paths.filter((path) => path.endsWith('/workflow')).length).toBeGreaterThan(0);
});

test('an owner can turn every area and location off while keeping management and restoration reachable', async ({
  page,
  harnessUrl,
}) => {
  const writes: unknown[] = [];
  let saved = false;
  await open(
    page,
    harnessUrl,
    (route) => {
      if (route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON());
        saved = true;
        return json(route, {
          data: { disabledPermissions: permissions, allLocations: false, revision: 1 },
        });
      }
      return json(route, {
        data: saved
          ? {
              ...admin,
              members: [{ ...owner, locationIds: [] }],
              ownerAccess: { disabledPermissions: permissions, allLocations: false, revision: 1 },
            }
          : admin,
      });
    },
    () =>
      saved
        ? {
            ...context,
            capabilities: {
              patients: { read: false, create: false },
              appointments: { read: false, create: false },
            },
            workspaceCapabilities: {
              patientsRead: false,
              appointmentsRead: false,
              documentsRead: false,
              configurationManage: false,
            },
            locations: [],
            ownerAccess: { disabledPermissions: permissions, allLocations: false, revision: 1 },
          }
        : context,
  );
  for (const name of [...areaNames].reverse()) {
    await area(page, name).uncheck();
  }
  await area(page, 'All Current And Future Locations').uncheck();
  await area(page, main.name).uncheck();
  await save(page).click();
  await expect(home(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Manage Team & Locations', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'My Workspace Access', exact: true }).click();
  for (const name of areaNames) {
    await expect(area(page, name)).not.toBeChecked();
  }
  await expect(page.getByRole('button', { name: 'Enable All Areas', exact: true })).toBeEnabled();
  expect(writes).toEqual([
    { disabledPermissions: permissions, allLocations: false, locationIds: [], revision: 0 },
  ]);
});

test('manual location access submits only the selected active locations and saved revision', async ({
  page,
  harnessUrl,
}) => {
  const writes: unknown[] = [];
  await open(page, harnessUrl, (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      return json(route, { data: {} });
    }
    return json(route, {
      data: { ...admin, ownerAccess: { ...profile, allLocations: false, revision: 3 } },
    });
  });
  await expect(area(page, main.name)).toBeChecked();
  await expect(area(page, second.name)).not.toBeChecked();
  await area(page, main.name).uncheck();
  await area(page, second.name).check();
  await save(page).click();
  await expect(home(page)).toBeVisible();
  expect(writes).toEqual([
    { disabledPermissions: [], allLocations: false, locationIds: [second.id], revision: 3 },
  ]);
});

test('restoring all areas and future locations remains an explicit saved choice', async ({
  page,
  harnessUrl,
}) => {
  const writes: unknown[] = [];
  await open(page, harnessUrl, (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      return json(route, { data: {} });
    }
    return json(route, {
      data: {
        ...admin,
        members: [{ ...owner, locationIds: [] }],
        ownerAccess: { disabledPermissions: permissions, allLocations: false, revision: 7 },
      },
    });
  });
  await page.getByRole('button', { name: 'Enable All Areas', exact: true }).click();
  for (const name of areaNames) {
    await expect(area(page, name)).toBeChecked();
  }
  await area(page, 'All Current And Future Locations').check();
  expect(writes).toEqual([]);
  await save(page).click();
  await expect(home(page)).toBeVisible();
  expect(writes).toEqual([
    { disabledPermissions: [], allLocations: true, locationIds: [], revision: 7 },
  ]);
});

test('patient account linking turns off with its prerequisites and is never silently enabled on their restoration', async ({
  page,
  harnessUrl,
}) => {
  const writes: unknown[] = [];
  await open(page, harnessUrl, (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      return json(route, { data: {} });
    }
    return json(route, { data: admin });
  });
  await area(page, 'Documents & Requests').uncheck();
  await expect(area(page, 'Patient Account Access')).not.toBeChecked();
  await expect(area(page, 'Patient Account Access')).toBeDisabled();
  await area(page, 'Documents & Requests').check();
  await expect(area(page, 'Patient Account Access')).toBeEnabled();
  await expect(area(page, 'Patient Account Access')).not.toBeChecked();
  await area(page, 'Patient Account Access').check();
  await area(page, 'Templates & Setup').uncheck();
  await expect(area(page, 'Patient Account Access')).not.toBeChecked();
  await save(page).click();
  await expect(home(page)).toBeVisible();
  expect(writes).toEqual([
    {
      disabledPermissions: ['org:paperwork:manage', 'org:workflow:configure'],
      allLocations: true,
      locationIds: [],
      revision: 0,
    },
  ]);
});

for (const [permission, name] of [
  ['org:documents:read', 'Documents & Requests'],
  ['org:workflow:configure', 'Templates & Setup'],
] as const) {
  test(`loading a saved ${permission === 'org:documents:read' ? 'document viewing' : 'template setup'} limit keeps patient account access off until explicitly enabled`, async ({
    page,
    harnessUrl,
  }) => {
    const writes: unknown[] = [];
    await open(page, harnessUrl, (route) => {
      if (route.request().method() === 'POST') {
        writes.push(route.request().postDataJSON());
        return json(route, { data: {} });
      }
      return json(route, {
        data: {
          ...admin,
          ownerAccess: { ...profile, disabledPermissions: [permission], revision: 8 },
        },
      });
    });
    const binding = area(page, 'Patient Account Access');
    await expect(binding).not.toBeChecked();
    await expect(binding).toBeDisabled();
    await area(page, name).check();
    await expect(binding).toBeEnabled();
    await expect(binding).not.toBeChecked();
    expect(writes).toEqual([]);
    await binding.check();
    await expect(binding).toBeChecked();
    expect(writes).toEqual([]);
    await save(page).click();
    await expect(home(page)).toBeVisible();
    expect(writes).toEqual([
      { disabledPermissions: [], allLocations: true, locationIds: [], revision: 8 },
    ]);
  });
}

test('a partially limited area stays indeterminate and preserves its exact saved permissions', async ({
  page,
  harnessUrl,
}) => {
  const writes: unknown[] = [];
  await open(page, harnessUrl, (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      return json(route, { data: {} });
    }
    return json(route, {
      data: {
        ...admin,
        ownerAccess: { ...profile, disabledPermissions: ['org:patients:create'], revision: 4 },
      },
    });
  });
  expect(
    await area(page, 'Patients').evaluate((element) => (element as HTMLInputElement).indeterminate),
  ).toBe(true);
  await expect(page.getByText('Partly enabled.', { exact: false })).toBeVisible();
  await save(page).click();
  await expect(home(page)).toBeVisible();
  expect(writes).toEqual([
    {
      disabledPermissions: ['org:patients:create'],
      allLocations: true,
      locationIds: [],
      revision: 4,
    },
  ]);
});

test('a stale revision preserves the draft and requires deliberate current-state review before another save', async ({
  page,
  harnessUrl,
}) => {
  let reads = 0;
  const writes: unknown[] = [];
  await open(page, harnessUrl, (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      return writes.length === 1
        ? json(
            route,
            { error: { code: 'OWNER_ACCESS_CHANGED', message: 'private server detail' } },
            409,
          )
        : json(route, { data: {} });
    }
    reads++;
    return json(route, {
      data: { ...admin, ownerAccess: { ...profile, revision: reads === 1 ? 1 : 2 } },
    });
  });
  await area(page, 'Patients').uncheck();
  await save(page).click();
  await expect(page.getByRole('alert')).toContainText('Review the current access');
  await expect(page.getByRole('alert')).not.toContainText('private server detail');
  await expect(area(page, 'Patients')).not.toBeChecked();
  await expect(save(page)).toBeDisabled();
  expect(reads).toBe(1);
  await page.getByRole('button', { name: 'Review Current Access', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
  await modal.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  expect(reads).toBe(1);
  await expect(area(page, 'Patients')).not.toBeChecked();
  await page.getByRole('button', { name: 'Review Current Access', exact: true }).click();
  await modal.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await expect(area(page, 'Patients')).toBeChecked();
  expect(reads).toBe(2);
  await area(page, 'Appointments').uncheck();
  await save(page).click();
  await expect(home(page)).toBeVisible();
  expect((writes[1] as { revision: number }).revision).toBe(2);
});

test('an interrupted save retains choices and retries the same revision without an automatic write', async ({
  page,
  harnessUrl,
}) => {
  const writes: unknown[] = [];
  await open(page, harnessUrl, (route) => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      return writes.length === 1 ? route.abort('connectionfailed') : json(route, { data: {} });
    }
    return json(route, { data: admin });
  });
  await area(page, 'Work & Activity').uncheck();
  await save(page).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(area(page, 'Work & Activity')).not.toBeChecked();
  expect(writes).toHaveLength(1);
  await save(page).click();
  await expect(home(page)).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test('a pending save locks navigation, account controls and fields and ignores duplicate submission', async ({
  page,
  harnessUrl,
}) => {
  let writes = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await open(page, harnessUrl, async (route) => {
    if (route.request().method() === 'POST') {
      writes++;
      await gate;
      return json(route, { data: {} });
    }
    return json(route, { data: admin });
  });
  await save(page).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => writes).toBe(1);
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await expect(checkbox).toBeDisabled();
  }
  await expect(page.locator('.cq-a-back')).toBeDisabled();
  await expect(page.locator('.wf-sidebar-foot[inert]')).toHaveCount(1);
  await expect(page.locator('.cq-a-loading:not(.cq-a-loading-inline)')).toContainText('Saving');
  release();
  await expect(home(page)).toBeVisible();
  expect(writes).toBe(1);
});

for (const status of [401, 403]) {
  test(`an owner-access save ${status} conceals the editor and refreshes current authority`, async ({
    page,
    harnessUrl,
  }) => {
    let lost = false;
    await open(
      page,
      harnessUrl,
      (route) => {
        if (route.request().method() === 'POST') {
          lost = true;
          return json(route, { error: { code: 'OWNER_REQUIRED' } }, status);
        }
        return json(route, { data: admin });
      },
      () => (lost ? { ...context, management: { locations: false, members: false } } : context),
    );
    await save(page).click();
    await expect(home(page)).toBeVisible();
    await expect(save(page)).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'My Workspace Access', exact: true }),
    ).toHaveCount(0);
  });
}

for (const invalid of [undefined, { ...profile, disabledPermissions: ['org:unknown:grant'] }]) {
  test(`a ${invalid ? 'malformed' : 'missing'} profile cannot create UI-inferred operator access`, async ({
    page,
    harnessUrl,
  }) => {
    let reads = 0,
      writes = 0;
    await open(page, harnessUrl, (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
      }
      reads++;
      return json(route, { data: { ...admin, ownerAccess: reads === 1 ? invalid : profile } });
    });
    await expect(page.getByRole('alert')).toContainText('could not be confirmed');
    await expect(save(page)).toHaveCount(0);
    expect(writes).toBe(0);
    await page.getByRole('button', { name: 'Try Again', exact: true }).click();
    await expect(area(page, 'Patients')).toBeChecked();
    expect(reads).toBe(2);
    expect(writes).toBe(0);
  });
}

test('unsaved Back and header Home require a focused reversible discard confirmation', async ({
  page,
  harnessUrl,
}) => {
  await open(page, harnessUrl);
  await area(page, 'Patients').uncheck();
  await page.locator('.cq-a-back').click();
  const modal = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Keep Editing', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(modal.getByRole('button', { name: 'Discard Changes', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.cq-a-back')).toBeFocused();
  await expect(area(page, 'Patients')).not.toBeChecked();
  await page
    .getByRole('navigation', { name: 'Practice Navigation', exact: true })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  await expect(area(page, 'Patients')).not.toBeChecked();
  await page.locator('.cq-a-back').click();
  await modal.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await expect(home(page)).toBeVisible();
});

test('the Spanish owner editor stays white and fits a 320px dark-system viewport', async ({
  page,
  harnessUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await open(page, harnessUrl);
  await page.getByRole('combobox', { name: 'Interface Language', exact: true }).selectOption('es');
  await expect(
    page.getByRole('heading', { name: 'Mi Acceso Al Espacio De Trabajo', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.cq-access')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Guardar Mi Acceso', exact: true })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Todas Las Sedes Actuales Y Futuras', exact: true }),
  ).toBeChecked();
  await page.getByRole('checkbox', { name: 'Pacientes', exact: true }).uncheck();
  await page.locator('.cq-a-back').click();
  await expect(
    page.getByRole('dialog', { name: '¿Salir sin guardar?', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the Settings owner row opens My workspace access instead of offering an owner role change', async ({
  page,
  harnessUrl,
}) => {
  let writes = 0;
  const teammate = {
    ...owner,
    userId: 'user_teammate',
    membershipId: 'membership_teammate',
    displayName: 'Synthetic teammate',
    email: 'teammate@example.invalid',
    isOwner: false,
    role: 'org:member',
  };
  await page.route('**/api/v1/**', (route) => {
    if (route.request().method() !== 'GET') {
      writes++;
    }
    return json(route, {
      data:
        new URL(route.request().url()).pathname === '/api/v1/me'
          ? context
          : { ...admin, members: [owner, teammate] },
    });
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await page.getByRole('button', { name: 'Manage Team & Locations', exact: true }).click();
  await page.getByRole('tab', { name: 'Team & Access', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Role', exact: true }).selectOption('org:admin');
  await page.getByRole('button', { name: 'My Workspace Access', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Role', exact: true })).toHaveValue('org:admin');
  await page.getByRole('button', { name: 'My Workspace Access', exact: true }).click();
  await modal.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'My Workspace Access', exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
});
