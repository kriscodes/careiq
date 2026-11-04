import type { Page, Route } from '@playwright/test';
import { test, expect } from './harness';
import type {
  AccessContext,
  WorkspaceCapabilities,
  WorkspaceView,
} from '../../src/lib/api/practice';

const assigned = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetic assigned location',
  timeZone: 'UTC',
  status: 'active' as const,
};
const noWorkspace: WorkspaceCapabilities = {
  patientsRead: false,
  appointmentsRead: false,
  documentsRead: false,
  configurationManage: false,
};
const context = (owner = false, caps = noWorkspace): AccessContext => ({
  userId: 'user_test',
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
    patients: { read: caps.patientsRead, create: false },
    appointments: { read: caps.appointmentsRead, create: false },
  },
  workspaceCapabilities: caps,
  management: { locations: owner, members: owner },
  locations: [],
});
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });
const navigation = (page: Page) =>
  page.getByRole('navigation', { name: 'Practice Navigation', exact: true });
const baseViews: readonly WorkspaceView[] = [
  'Today',
  'Schedule',
  'Patients',
  'Documents',
  'Templates',
];
async function mockAccount(route: Route) {
  await json(route, {
    data: {
      account: { status: 'active', archiveRequestedAt: null, archivedAt: null, restoredAt: null },
      ownedPractices: [],
      closureRequest: null,
    },
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) =>
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
});

for (const owner of [true, false]) {
  test(`an active ${owner ? 'owner' : 'member'} with no clinical grants enters the main application and restricted views never request records`, async ({
    page,
    harnessUrl,
  }) => {
    const paths: string[] = [];
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      paths.push(path);
      if (path === '/api/v1/me') {
        return json(route, { data: context(owner) });
      }
      if (path === '/api/v1/account') {
        return mockAccount(route);
      }
      return json(route, { error: { code: 'UNEXPECTED_PROTECTED_READ' } }, 403);
    });
    await page.goto(
      `${harnessUrl}/?component=workspace&identityRole=${owner ? 'admin' : 'member'}`,
    );
    await expect(page.locator('.wf-shell')).toBeVisible();
    await expect(
      navigation(page).getByRole('button', { name: 'Home', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    for (const view of baseViews) {
      const button = navigation(page).getByRole('button', {
        name: view === 'Schedule' ? 'Appointments' : view,
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.click();
      await expect(button).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('.wf-kpis')).toHaveCount(0);
      await expect(page.locator('.wf-paperwork-list')).toHaveCount(0);
    }
    await navigation(page).getByRole('button', { name: 'Home', exact: true }).click();
    await expect(
      navigation(page).getByRole('button', { name: 'Home', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(paths.every((path) => path === '/api/v1/me')).toBe(true);
    await expect(
      navigation(page).getByRole('button', { name: 'Practice', exact: true }),
    ).toHaveCount(owner ? 1 : 0);
    await page
      .locator('.wf-sidebar')
      .getByRole('button', { name: 'Personal Account', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Personal Account', exact: true }),
    ).toBeVisible();
    expect(paths.filter((path) => path !== '/api/v1/me')).toEqual(['/api/v1/account']);
  });
}

test('management-only owner reaches team settings and returns to the main application without a location or patient grant', async ({
  page,
  harnessUrl,
}) => {
  const paths: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path === '/api/v1/me') {
      return json(route, { data: context(true) });
    }
    if (path === '/api/v1/practice/admin') {
      return json(route, {
        data: {
          locations: [],
          members: [],
          invitations: [],
          allowedRoles: ['org:admin', 'org:member'],
        },
      });
    }
    return json(route, { error: { code: 'UNEXPECTED_PROTECTED_READ' } }, 403);
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await expect(page.locator('.wf-shell')).toBeVisible();
  await navigation(page).getByRole('button', { name: 'Practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Practice Settings', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Team & Access', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Team & Access', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Where are you working?', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.wf-shell')).toBeVisible();
  expect(paths.filter((path) => path !== '/api/v1/me')).toEqual(['/api/v1/practice/admin']);
});

for (const [grant, view] of [
  ['appointmentsRead', 'Today'],
  ['patientsRead', 'Patients'],
  ['documentsRead', 'Documents'],
  ['configurationManage', 'Templates'],
] as const) {
  test(`${grant}-only staff opens ${view} in the real workspace after assigned-location selection`, async ({
    page,
    harnessUrl,
  }) => {
    const caps = { ...noWorkspace, [grant]: true };
    const value = { ...context(false, caps), locations: [assigned] };
    let reads = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/me') {
        return json(route, { data: value });
      }
      if (path.endsWith('/workflow')) {
        reads++;
        return json(route, {
          data: {
            location: assigned,
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
            capabilities: caps,
            asOf: '2026-10-30T12:00:00Z',
          },
        });
      }
      if (path.endsWith('/notifications')) {
        return json(route, { data: [], unreadCount: 0 });
      }
      return json(route, { data: [] });
    });
    await page.goto(`${harnessUrl}/?component=workspace`);
    await expect(page.locator('.wf-shell')).toBeVisible();
    expect(reads).toBe(0);
    await navigation(page).getByRole('button', { name: view, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Where are you working?', exact: true }),
    ).toBeVisible();
    expect(reads).toBe(0);
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect.poll(() => reads).toBeGreaterThan(0);
    await expect(navigation(page).getByRole('button', { name: view, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    if (view === 'Documents' || view === 'Templates' || view === 'Patients') {
      await expect(page.locator('.wf-kpis')).toHaveCount(0);
    }
    await navigation(page).getByRole('button', { name: 'Home', exact: true }).click();
    await expect(
      navigation(page).getByRole('button', { name: 'Home', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });
}

test('an active user without an assigned location still has main application navigation while clinical views stay closed', async ({
  page,
  harnessUrl,
}) => {
  const paths: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    paths.push(new URL(route.request().url()).pathname);
    return json(route, { data: context(false, { ...noWorkspace, documentsRead: true }) });
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await expect(page.locator('.wf-shell')).toBeVisible();
  await navigation(page).getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(
    page.getByText(
      'Your role can open a workspace, but you don’t have an active location assignment yet.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator('.wf-kpis')).toHaveCount(0);
  expect(paths.every((path) => path === '/api/v1/me')).toBe(true);
});

for (const enrollmentStatus of ['pending_assignment', 'suspended', 'revoked']) {
  test(`${enrollmentStatus} members stay outside protected application content`, async ({
    page,
    harnessUrl,
  }) => {
    const paths: string[] = [];
    await page.route('**/api/v1/**', (route) => {
      paths.push(new URL(route.request().url()).pathname);
      return json(route, { data: { ...context(), onboarding: 'pending', enrollmentStatus } });
    });
    await page.goto(`${harnessUrl}/?component=workspace`);
    await expect(page.getByRole('button', { name: 'Personal Account', exact: true })).toBeVisible();
    await expect(page.locator('.wf-shell')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Practice Navigation', exact: true }),
    ).toHaveCount(0);
    expect(paths).toEqual(['/api/v1/me']);
  });
}

test('the main application frame remains white, narrow-screen navigable and keyboard accessible with no clinical grants', async ({
  page,
  harnessUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.route('**/api/v1/me', (route) => json(route, { data: context(true) }));
  await page.goto(`${harnessUrl}/?component=workspace`);
  const frame = page.locator('.cq-application-frame');
  await expect(frame).toBeVisible();
  await expect(frame).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Expand Navigation', exact: true }).click();
  const home = navigation(page).getByRole('button', { name: 'Home', exact: true });
  await home.focus();
  await page.keyboard.press('Tab');
  const today = navigation(page).getByRole('button', { name: 'Today', exact: true });
  await expect(today).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Expand Navigation', exact: true }).click();
  await expect(today).toHaveAttribute('aria-current', 'page');
});

test('legacy patient-only users retain a real main application to patient directory and Home roundtrip', async ({
  page,
  harnessUrl,
}) => {
  const legacy = context(false, { ...noWorkspace, patientsRead: true });
  legacy.practice!.authorizationMode = 'legacy';
  legacy.enrollmentStatus = null;
  const paths: string[] = [];
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path === '/api/v1/me') {
      return json(route, { data: legacy });
    }
    if (path === '/api/v1/patients') {
      return json(route, {
        data: [],
        meta: { limit: 100, offset: 0, hasMore: false, nextOffset: null },
      });
    }
    return json(route, { error: { code: 'UNEXPECTED_PROTECTED_READ' } }, 403);
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await expect(page.locator('.wf-shell')).toBeVisible();
  await navigation(page).getByRole('button', { name: 'Patients', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Good care starts with people.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Where are you working?', exact: true }),
  ).toHaveCount(0);
  expect(paths.filter((path) => path !== '/api/v1/me')).toEqual(['/api/v1/patients']);
  await navigation(page).getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('.wf-shell')).toBeVisible();
  await expect(navigation(page).getByRole('button', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
