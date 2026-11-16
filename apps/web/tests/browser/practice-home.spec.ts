import type { Page, Route } from '@playwright/test';
import { test, expect } from './harness';
import type { AccessContext, WorkspaceCapabilities } from '../../src/lib/api/practice';

// These access fixtures use UTC locations; date-reconciliation behavior has separate tests.
test.use({ timezoneId: 'UTC' });

const first = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Main location',
  timeZone: 'UTC',
  status: 'active' as const,
};
const second = { ...first, id: '22222222-2222-4222-8222-222222222222', name: 'Second location' };
const noWorkspace: WorkspaceCapabilities = {
  patientsRead: false,
  appointmentsRead: false,
  documentsRead: false,
  configurationManage: false,
};
const context = (caps: WorkspaceCapabilities, owner = false): AccessContext => ({
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
  locations: [first],
});
const snapshot = (caps: WorkspaceCapabilities, location = first) => ({
  location,
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
});
const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
const home = (page: Page) => page.getByRole('heading', { name: 'Hello again.', exact: true });
async function enterWorkspace(page: Page) {
  await page.getByRole('button', { name: 'Open Workspace', exact: true }).click();
  const choose = page.getByRole('heading', { name: 'Where are you working?', exact: true });
  await expect(choose).toBeVisible();
  await page.getByRole('button', { name: /^Continue/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)) {
      return route.abort('blockedbyclient');
    }
    await route.continue();
  });
});

for (const owner of [false, true]) {
  test(`${owner ? 'owner' : 'member'} without workspace grants gets a useful home without forbidden workflow reads`, async ({
    page,
    harnessUrl,
  }) => {
    const paths: string[] = [];
    await page.route('**/api/v1/**', async (route) => {
      paths.push(new URL(route.request().url()).pathname);
      await json(route, { data: context(noWorkspace, owner) });
    });
    await page.goto(
      `${harnessUrl}/?component=workspace&identityRole=${owner ? 'admin' : 'member'}`,
    );
    await expect(home(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Workspace', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Where are you working?', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Manage Team & Locations', exact: true }),
    ).toHaveCount(owner ? 1 : 0);
    await expect(page.locator('.wf-shell')).toBeVisible();
    const today = page
      .getByRole('navigation', { name: 'Practice Navigation', exact: true })
      .getByRole('button', { name: 'Today', exact: true });
    await today.click();
    await expect(
      page.getByRole('heading', { name: 'This area needs permission', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Your current role does not include Today. You can keep using the rest of CareIQ.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('.wf-kpis')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Personal Account', exact: true })).toBeVisible();
    expect(paths).toEqual(['/api/v1/me']);
  });
}

for (const grant of Object.keys(noWorkspace) as Array<keyof WorkspaceCapabilities>) {
  test(`${grant}-only staff lands home and explicitly opens its assigned workspace`, async ({
    page,
    harnessUrl,
  }) => {
    const caps = { ...noWorkspace, [grant]: true };
    let reads = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/me') {
        return json(route, { data: context(caps) });
      }
      if (path.endsWith('/workflow')) {
        reads++;
        return json(route, { data: snapshot(caps) });
      }
      if (path.endsWith('/notifications')) {
        return json(route, { data: [], unreadCount: 0 });
      }
      return json(route, { data: [] });
    });
    await page.goto(`${harnessUrl}/?component=workspace`);
    await expect(home(page)).toBeVisible();
    expect(reads).toBe(0);
    await enterWorkspace(page);
    await expect(page.locator('.wf-page-head')).toBeVisible();
    await expect(page.getByText('Opening Your Front Desk…', { exact: true })).toHaveCount(0);
    expect(reads).toBeGreaterThan(0);
    await page
      .getByRole('navigation', { name: 'Practice Navigation', exact: true })
      .getByRole('button', { name: 'Home', exact: true })
      .click();
    await expect(home(page)).toBeVisible();
  });
}

for (const status of [401, 403]) {
  test(`workflow${status} removes records and lands on an explained home without automatic retry`, async ({
    page,
    harnessUrl,
  }) => {
    const caps = { ...noWorkspace, patientsRead: true };
    let reads = 0,
      checks = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/me') {
        checks++;
        return json(route, { data: context(caps, true) });
      }
      reads++;
      return json(
        route,
        {
          error: {
            code: status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
            message: 'Synthetic access failure',
          },
        },
        status,
      );
    });
    await page.goto(`${harnessUrl}/?component=workspace`);
    await enterWorkspace(page);
    await expect(home(page)).toBeVisible();
    await expect(
      page.locator('.cq-app-home').getByRole('status').filter({
        hasText:
          'Workspace access could not be confirmed. No records are open. Check your access before trying again.',
      }),
    ).toBeVisible();
    await expect(page.locator('.wf-page-head')).toHaveCount(0);
    expect(reads).toBe(1);
    expect(checks).toBe(2);
    await page.getByRole('button', { name: 'Check Access Again', exact: true }).click();
    await expect(home(page)).toBeVisible();
    expect(reads).toBe(1);
    expect(checks).toBe(3);
  });
}

test('a failed authorization recheck after workflow401 stays on a retryable home', async ({
  page,
  harnessUrl,
}) => {
  const caps = { ...noWorkspace, patientsRead: true };
  let checks = 0,
    reads = 0;
  await page.route('**/api/v1/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/v1/me' && ++checks === 1) {
      return json(route, { data: context(caps) });
    }
    reads++;
    return json(route, { error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }, 401);
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await enterWorkspace(page);
  await expect(page.getByRole('heading', { name: 'Practice Home', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try Again', exact: true })).toBeVisible();
  await expect(page.locator('.wf-page-head')).toHaveCount(0);
  expect(reads).toBe(2);
  expect(checks).toBe(2);
});

for (const changed of ['none', 'assignment', 'permission'] as const) {
  test(`background resume freshly checks authorization and ${changed === 'none' ? 'keeps the selected location' : 'lands home after changed ' + changed}`, async ({
    page,
    harnessUrl,
  }) => {
    const caps = { ...noWorkspace, patientsRead: true };
    let checks = 0,
      release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const paths: string[] = [];
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/me') {
        checks++;
        if (checks > 1) {
          await gate;
        }
        return json(route, {
          data: {
            ...context(changed === 'permission' && checks > 1 ? noWorkspace : caps),
            locations: changed === 'assignment' && checks > 1 ? [first] : [first, second],
          },
        });
      }
      paths.push(path);
      return json(route, { data: snapshot(caps, second) });
    });
    await page.goto(`${harnessUrl}/?component=workspace`);
    await page.getByRole('button', { name: 'Open Workspace', exact: true }).click();
    await page.getByRole('radio', { name: /Second location/ }).check();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.locator('.wf-page-head')).toBeVisible();
    await expect(page.getByText('Opening Your Front Desk…', { exact: true })).toHaveCount(0);
    const readsBeforePause = paths.length;
    expect(readsBeforePause).toBeGreaterThan(0);
    expect(paths.every((path) => path === `/api/v1/locations/${second.id}/workflow`)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(
      page.getByRole('heading', { name: 'Your workspace is paused', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.wf-page-head')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => checks).toBe(2);
    expect(paths).toHaveLength(readsBeforePause);
    await expect(page.locator('.wf-page-head')).toHaveCount(0);
    release();
    if (changed === 'none') {
      await expect(page.locator('.wf-page-head')).toBeVisible();
      await expect(
        page.getByRole('combobox', { name: 'Working Location', exact: true }),
      ).toHaveValue(second.id);
      await expect.poll(() => paths.length).toBeGreaterThan(readsBeforePause);
      expect(paths.every((path) => path === `/api/v1/locations/${second.id}/workflow`)).toBe(true);
    } else {
      await expect(home(page)).toBeVisible();
      await expect(
        page.locator('.cq-app-home').getByRole('status').filter({
          hasText:
            'Your access or location assignment changed. Review your access before opening a workspace.',
        }),
      ).toBeVisible();
      expect(paths).toHaveLength(readsBeforePause);
    }
  });
}

test('ownership transfer keeps its receipt visible through refresh and returns the prior owner to home', async ({
  page,
  harnessUrl,
}) => {
  let transferred = false,
    checks = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writes: unknown[] = [];
  const admin = {
    locations: [first],
    members: [
      {
        userId: 'user_test',
        membershipId: 'member_owner',
        isOwner: true,
        displayName: 'Synthetic owner',
        email: 'owner@example.invalid',
        role: 'org:admin',
        status: 'active',
        locationIds: [first.id],
      },
      {
        userId: 'user_recipient',
        membershipId: 'member_recipient',
        isOwner: false,
        displayName: 'Synthetic recipient',
        email: 'recipient@example.invalid',
        role: 'org:admin',
        status: 'active',
        locationIds: [],
      },
    ],
    invitations: [],
    allowedRoles: ['org:admin', 'org:member'],
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/me') {
      checks++;
      if (transferred) {
        await gate;
      }
      return json(route, { data: context(noWorkspace, !transferred) });
    }
    if (route.request().method() === 'POST') {
      transferred = true;
      writes.push(route.request().postDataJSON());
      return json(route, { data: { ownerUserId: 'user_recipient' } });
    }
    return json(route, { data: admin });
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await page.getByRole('button', { name: 'Manage Team & Locations', exact: true }).click();
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'New Owner', exact: true })
    .selectOption('user_recipient');
  await page
    .getByRole('textbox', { name: 'Type Synthetic practice To Confirm', exact: true })
    .fill('Synthetic practice');
  await page
    .getByRole('button', {
      name: 'Transfer Ownership To Synthetic recipient (recipient@example.invalid)',
      exact: true,
    })
    .click();
  await expect(page.getByRole('heading', { name: 'Practice Home', exact: true })).toBeVisible();
  const receipt = page.getByText(
    'Ownership of Synthetic practice was transferred to Synthetic recipient (recipient@example.invalid). Your personal account was not transferred.',
    { exact: true },
  );
  await expect(receipt).toBeVisible();
  await expect.poll(() => checks).toBe(2);
  release();
  await expect(page.getByRole('heading', { name: 'Your Workspace', exact: true })).toBeVisible();
  await expect(receipt).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Manage Team & Locations', exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual([
    {
      userId: 'user_recipient',
      practiceId: 'practice_test',
      confirmationName: 'Synthetic practice',
      acknowledgedUserId: 'user_recipient',
    },
  ]);
});

test('legacy clinical-read403 returns to explained home without repeating the denied read', async ({
  page,
  harnessUrl,
}) => {
  const caps = { ...noWorkspace, patientsRead: true };
  const legacy = context(caps);
  legacy.practice!.authorizationMode = 'legacy';
  legacy.enrollmentStatus = null;
  legacy.locations = [];
  let checks = 0,
    reads = 0;
  await page.route('**/api/v1/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/v1/me') {
      checks++;
      return json(route, { data: legacy });
    }
    reads++;
    return json(
      route,
      { error: { code: 'FORBIDDEN', message: 'Synthetic legacy read denied' } },
      403,
    );
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await expect(home(page)).toBeVisible();
  expect(reads).toBe(0);
  await page.getByRole('button', { name: 'Open Workspace', exact: true }).click();
  await expect(
    page.locator('.cq-app-home').getByRole('status').filter({
      hasText:
        'Workspace access could not be confirmed. No records are open. Check your access before trying again.',
    }),
  ).toBeVisible();
  await expect(home(page)).toBeVisible();
  await expect(page.locator('.cq-shell')).toHaveCount(0);
  expect(reads).toBe(1);
  expect(checks).toBe(2);
});

for (const scenario of ['memberships-loading', 'memberships-paged']) {
  test(`current practice remains labeled during ${scenario} without changing access`, async ({
    page,
    harnessUrl,
  }) => {
    const paths: string[] = [];
    await page.route('**/api/v1/**', async (route) => {
      paths.push(new URL(route.request().url()).pathname);
      await json(route, { data: context(noWorkspace) });
    });
    await page.goto(`${harnessUrl}/?component=workspace&identityRole=member&scenario=${scenario}`);
    await expect(home(page)).toBeVisible();
    const picker = page.getByRole('combobox', { name: 'Workspace', exact: true });
    await expect(picker).toHaveValue('org_test');
    await expect(picker.locator('option:checked')).toHaveText('Synthetic practice');
    await expect(page.getByRole('button', { name: 'Open Workspace', exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      if (!window.__careiqMemberships) {
        throw new Error('Deferred membership fixture missing');
      }
      window.__careiqMemberships.resolve();
    });
    await expect(picker.locator('option:checked')).toHaveText('Test practice');
    await expect(picker.locator('option[value="org_test"]')).toHaveCount(1);
    await expect(picker).toHaveValue('org_test');
    await expect(page.getByRole('button', { name: 'Open Workspace', exact: true })).toHaveCount(0);
    expect(paths).toEqual(['/api/v1/me']);
    expect(
      await page.evaluate(() =>
        window.__careiqMockCalls.filter((call) => call.name === 'setActive'),
      ),
    ).toEqual([]);
  });
}
