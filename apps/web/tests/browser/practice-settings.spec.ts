import type { Page, Route } from '@playwright/test';
import { test, expect } from './harness';

const context = {
  userId: 'user_settings_owner',
  orgId: 'org_test',
  practice: {
    id: 'practice_settings',
    name: 'Synthetic practice',
    authorizationMode: 'location',
    status: 'active',
  },
  onboarding: 'ready',
  enrollmentStatus: 'active',
  capabilities: {
    patients: { read: false, create: false },
    appointments: { read: false, create: false },
  },
  management: { locations: true, members: true },
  locations: [],
};
const admin = {
  locations: [
    {
      id: 'location_settings',
      name: 'Synthetic main location',
      timeZone: 'America/Los_Angeles',
      status: 'active',
    },
  ],
  members: [
    {
      userId: 'user_settings_owner',
      membershipId: 'membership_owner',
      displayName: 'Synthetic owner',
      email: 'owner@example.invalid',
      status: 'active',
      role: 'org:admin',
      locationIds: ['location_settings'],
      isOwner: true,
    },
  ],
  invitations: [],
  allowedRoles: ['org:admin', 'org:member'],
};
const json = (route: Route, data: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
async function openSettings(
  page: Page,
  harnessUrl: string,
  respond?: (route: Route) => Promise<void>,
  readContext = () => context,
) {
  await page.route('**/api/v1/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/v1/me') {
      return json(route, { data: readContext() });
    }
    return respond ? respond(route) : json(route, { data: admin });
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await page.getByRole('button', { name: 'Manage Team & Locations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Practice Settings', exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)) {
      return route.abort('blockedbyclient');
    }
    await route.continue();
  });
});

test('settings retains the shared header while loading and puts Done after its content', async ({
  page,
  harnessUrl,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openSettings(page, harnessUrl, async (route) => {
    await gate;
    await json(route, { data: admin });
  });
  const header = page.locator('.cq-application-frame .wf-topbar');
  await expect(header.getByLabel('Interface Language', { exact: true })).toBeVisible();
  await expect(
    page.locator('.wf-sidebar').getByRole('button', { name: 'Test account', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Practice Navigation', exact: true })
      .getByRole('button', { name: 'Practice', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.cq-a-header')).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(page.locator('.cq-a-loading')).toHaveText('Opening Practice Settings…');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.cq-a-loading-character')).toHaveCSS(
    'animation-name',
    'cq-a-loading-float',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.cq-a-loading-character')).toHaveCSS('animation-name', 'none');
  release();
  await page.getByRole('tab', { name: 'Team & Access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Team Access', exact: true })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  expect((await page.locator('.cq-settings').boundingBox())!.width).toBeGreaterThan(700);
  expect(
    await page
      .locator('.cq-settings')
      .evaluate((element) =>
        Boolean(
          element
            .querySelector('[role="tabpanel"]:not([hidden])')!
            .compareDocumentPosition(element.querySelector('.cq-settings-done')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  await page
    .locator('.cq-settings-done')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.locator('.cq-app-home')).toBeVisible();
});

test('settings loading failure keeps account controls and a working retry', async ({
  page,
  harnessUrl,
}) => {
  let reads = 0;
  await openSettings(page, harnessUrl, async (route) => {
    reads++;
    return reads === 1
      ? json(route, { error: { code: 'UNAVAILABLE', message: 'Synthetic failure' } }, 503)
      : json(route, { data: admin });
  });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.locator('.wf-sidebar').getByRole('button', { name: 'Test account', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Locations', exact: true })).toBeVisible();
  expect(reads).toBe(2);
});

test('adding a location submits the selected territory zone without typing an IANA name', async ({
  page,
  harnessUrl,
}) => {
  const writes: { path: string; body: unknown }[] = [];
  await openSettings(page, harnessUrl, async (route) => {
    if (route.request().method() === 'POST') {
      writes.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
      });
    }
    return json(route, { data: admin });
  });
  const form = page.getByRole('group', { name: 'Add A Location', exact: true });
  const zone = form.getByRole('combobox', { name: 'Time Zone', exact: true });
  await expect(form.getByRole('textbox', { name: 'Time Zone', exact: true })).toHaveCount(0);
  await expect(
    zone.getByRole('option', { name: 'Arizona (no daylight saving)', exact: true }),
  ).toHaveAttribute('value', 'America/Phoenix');
  await expect(zone.getByRole('option', { name: 'American Samoa', exact: true })).toHaveAttribute(
    'value',
    'Pacific/Pago_Pago',
  );
  await form.getByLabel('Name', { exact: true }).fill('  Synthetic territory office  ');
  await zone.selectOption('America/Puerto_Rico');
  const address = form.getByLabel('Address (Optional)', { exact: true });
  await expect(address).toHaveAttribute('autocomplete', 'street-address');
  await expect(address).toHaveAttribute('maxlength', '500');
  await address.fill('  1 Synthetic Street  ');
  await form.getByRole('button', { name: 'Add Location', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    path: '/api/v1/locations',
    body: {
      name: 'Synthetic territory office',
      timeZone: 'America/Puerto_Rico',
      address: '1 Synthetic Street',
    },
  });
});

test('onboarding preserves a valid saved non-US zone and reuses localized US choices', async ({
  page,
  harnessUrl,
}) => {
  const saved: unknown[] = [];
  const draft = {
    practiceName: 'Synthetic practice',
    locationName: 'Synthetic London office',
    timeZone: 'Europe/London',
    address: '',
    step: 2,
  };
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().method() === 'PUT') {
      saved.push(route.request().postDataJSON());
      return json(route, { data: route.request().postDataJSON() });
    }
    return json(route, { data: { eligible: true, emailVerified: true, draft, operation: null } });
  });
  await page.goto(`${harnessUrl}/?component=onboarding`);
  const zone = page.getByRole('combobox', { name: 'Time Zone', exact: true });
  await expect(zone).toHaveValue('Europe/London');
  await expect(zone.getByRole('option')).toHaveCount(14);
  await expect(
    zone.getByRole('option', { name: 'Guam & Northern Mariana Islands', exact: true }),
  ).toHaveAttribute('value', 'Pacific/Guam');
  await page.getByLabel('Interface Language', { exact: true }).selectOption('es');
  await expect(page.getByRole('combobox', { name: 'Zona Horaria', exact: true })).toHaveValue(
    'Europe/London',
  );
  await expect(
    page.getByRole('option', { name: 'Hora Del Pacífico', exact: true }),
  ).toHaveAttribute('value', 'America/Los_Angeles');
  await page
    .getByRole('combobox', { name: 'Zona Horaria', exact: true })
    .selectOption('Pacific/Guam');
  await page.getByRole('button', { name: 'Guardar Y Terminar Más Tarde', exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toEqual({ ...draft, timeZone: 'Pacific/Guam' });
});

test('settings stays white and its primary hover stays blue at a narrow dark-system viewport', async ({
  page,
  harnessUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await openSettings(page, harnessUrl);
  await expect(page.getByRole('heading', { name: 'Locations', exact: true })).toBeVisible();
  await expect(page.locator('.cq-access')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('combobox', { name: 'Time Zone', exact: true })).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  for (const button of await page.locator('.cq-settings .cq-primary:visible').all()) {
    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(0, 87, 197)');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('ownership failure preserves confirmation and success exits settings before refreshing former-owner controls', async ({
  page,
  harnessUrl,
}) => {
  const recipient = {
    userId: 'user_settings_recipient',
    membershipId: 'membership_recipient',
    displayName: 'Synthetic administrator',
    email: 'administrator@example.invalid',
    status: 'active',
    role: 'org:admin',
    locationIds: ['location_settings'],
    isOwner: false,
  };
  const directory = { ...admin, members: [...admin.members, recipient] };
  const transfers: unknown[] = [];
  let directoryReads = 0;
  let transferred = false;
  await openSettings(
    page,
    harnessUrl,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/practice/ownership') {
        transfers.push(route.request().postDataJSON());
        if (transfers.length === 1) {
          return json(
            route,
            {
              error: {
                code: 'OWNERSHIP_CONFIRMATION_REQUIRED',
                message: 'Confirm the current practice and recipient.',
              },
            },
            409,
          );
        }
        transferred = true;
        return json(route, { data: {} });
      }
      directoryReads++;
      return json(route, { data: directory });
    },
    () =>
      transferred ? { ...context, management: { locations: false, members: false } } : context,
  );
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  const transfer = page.locator('.cq-ownership-transfer');
  await transfer
    .getByRole('combobox', { name: 'New Owner', exact: true })
    .selectOption(recipient.userId);
  const phrase = transfer.getByRole('textbox', {
    name: 'Type Synthetic practice To Confirm',
    exact: true,
  });
  await phrase.fill('Synthetic practice');
  const submit = transfer.getByRole('button', {
    name: 'Transfer Ownership To Synthetic administrator (administrator@example.invalid)',
    exact: true,
  });
  await submit.click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(phrase).toHaveValue('Synthetic practice');
  await expect(transfer.getByRole('combobox', { name: 'New Owner', exact: true })).toHaveValue(
    recipient.userId,
  );
  await submit.click();
  await expect(page.locator('.cq-app-home')).toBeVisible();
  await expect(page.locator('.cq-app-home').getByRole('status')).toContainText(
    recipient.displayName,
  );
  await expect(page.locator('.cq-app-home').getByRole('status')).toContainText(
    context.practice.name,
  );
  await expect(
    page.getByRole('button', { name: 'Manage Team & Locations', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Practice Settings', exact: true })).toHaveCount(
    0,
  );
  expect(directoryReads).toBe(1);
  expect(transfers).toEqual(
    Array(2).fill({
      userId: recipient.userId,
      practiceId: context.practice.id,
      confirmationName: context.practice.name,
      acknowledgedUserId: recipient.userId,
    }),
  );
});

test('ownership selection survives separate input and change events before confirmation', async ({
  page,
  harnessUrl,
}) => {
  const recipients = [
    {
      ...admin.members[0],
      userId: 'user_keyboard_alex',
      membershipId: 'membership_keyboard_alex',
      displayName: 'Synthetic Alex',
      email: 'alex@example.invalid',
      isOwner: false,
    },
    {
      ...admin.members[0],
      userId: 'user_keyboard_blair',
      membershipId: 'membership_keyboard_blair',
      displayName: 'Synthetic Blair',
      email: 'blair@example.invalid',
      isOwner: false,
    },
  ];
  let writes = 0;
  await openSettings(page, harnessUrl, (route) => {
    if (route.request().method() !== 'GET') {
      writes++;
    }
    return json(route, { data: { ...admin, members: [...admin.members, ...recipients] } });
  });
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  const select = page.getByRole('combobox', { name: 'New Owner', exact: true });
  // A browser can finish input before dispatching change; selectOption batches both.
  const choose = async (userId: string) => {
    await select.evaluate((element, value) => {
      (element as HTMLSelectElement).value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }, userId);
    await expect(select).toHaveValue(userId);
    await select.dispatchEvent('change');
    await expect(select).toHaveValue(userId);
  };
  await choose(recipients[0].userId);
  const phrase = page.getByRole('textbox', {
    name: 'Type Synthetic practice To Confirm',
    exact: true,
  });
  await expect(phrase).toBeVisible();
  await phrase.fill('Synthetic practice');
  await expect(
    page.getByRole('button', {
      name: 'Transfer Ownership To Synthetic Alex (alex@example.invalid)',
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.locator('.cq-settings')).toHaveAttribute('data-unsaved', 'true');
  await choose(recipients[1].userId);
  await expect(phrase).toHaveValue('');
  await expect(
    page.getByRole('button', {
      name: 'Transfer Ownership To Synthetic Blair (blair@example.invalid)',
      exact: true,
    }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});

test('selected ownership confirmation keeps a long recipient readable at 320px', async ({
  page,
  harnessUrl,
}) => {
  const recipient = {
    userId: 'user_settings_long_recipient',
    membershipId: 'membership_long_recipient',
    displayName: 'Synthetic administrator with a deliberately long family name',
    email: 'syntheticadministratorwithaverylongcontrolledalias+careiqreview@example.invalid',
    status: 'active',
    role: 'org:admin',
    locationIds: ['location_settings'],
    isOwner: false,
  };
  const directory = { ...admin, members: [...admin.members, recipient] };
  let writes = 0;
  await page.setViewportSize({ width: 320, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await openSettings(page, harnessUrl, async (route) => {
    if (route.request().method() !== 'GET') {
      writes++;
    }
    return json(route, { data: directory });
  });
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  const transfer = page.locator('.cq-ownership-transfer');
  await transfer
    .getByRole('combobox', { name: 'New Owner', exact: true })
    .selectOption(recipient.userId);
  await transfer
    .getByRole('textbox', { name: 'Type Synthetic practice To Confirm', exact: true })
    .fill('Synthetic practice');
  const warning = transfer.locator('.cq-ownership-warning');
  const confirmation = transfer.getByRole('button', {
    name: `Transfer Ownership To ${recipient.displayName} (${recipient.email})`,
    exact: true,
  });
  await expect(warning).toContainText(recipient.displayName);
  await expect(warning).toContainText(recipient.email);
  await expect(warning).toContainText('lose owner controls');
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeEnabled();
  for (const control of [warning, confirmation]) {
    expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((element) => element.getBoundingClientRect().right > innerWidth)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        right: element.getBoundingClientRect().right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      })),
  );
  expect(overflowing).toEqual([]);
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    scrollX,
  }));
  expect(layout).toEqual({ scrollWidth: 320, innerWidth: 320, scrollX: 0 });
  expect(writes).toBe(0);
});

test('settings tabs expose matching panels and keyboard activation', async ({
  page,
  harnessUrl,
}) => {
  await openSettings(page, harnessUrl);
  const locations = page.getByRole('tab', { name: 'Locations', exact: true });
  const team = page.getByRole('tab', { name: 'Team & Access', exact: true });
  await expect(locations).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(page.getByRole('tabpanel', { name: 'Locations', exact: true })).toBeVisible();
  await locations.focus();
  await page.keyboard.press('ArrowRight');
  await expect(team).toBeFocused();
  await expect(locations).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(team).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Team & Access', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Add A Location', exact: true })).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Ownership', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(locations).toBeFocused();
});

test('tab activation cannot steal focus from a following navigation key', async ({
  page,
  harnessUrl,
}) => {
  await openSettings(page, harnessUrl);
  const team = page.getByRole('tab', { name: 'Team & Access', exact: true });
  await expect(team).toBeEnabled();
  await team.focus();
  await team.evaluate(async (button) => {
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected a settings tab button');
    }
    // Both user actions occur before the next frame, exposing delayed focus restoration.
    button.click();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await expect(team).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Team & Access', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Ownership', exact: true })).toBeFocused();
});

test('unsaved tab and Done transitions require an accessible deliberate discard', async ({
  page,
  harnessUrl,
}) => {
  await openSettings(page, harnessUrl);
  const name = page
    .getByRole('group', { name: 'Add A Location', exact: true })
    .getByLabel('Name', { exact: true });
  await name.fill('Synthetic unsaved location');
  const team = page.getByRole('tab', { name: 'Team & Access', exact: true });
  await team.click();
  const modal = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Keep Editing', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(modal.getByRole('button', { name: 'Discard Changes', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(modal.getByRole('button', { name: 'Keep Editing', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(team).toBeFocused();
  await expect(name).toHaveValue('Synthetic unsaved location');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  await expect(name).toHaveValue('Synthetic unsaved location');
  await team.click();
  await modal.getByRole('button', { name: 'Discard Changes', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Team & Access', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Locations', exact: true }).click();
  await expect(
    page
      .getByRole('group', { name: 'Add A Location', exact: true })
      .getByLabel('Name', { exact: true }),
  ).toHaveValue('');
});

test('typed ownership confirmation survives cancelled tab and Home navigation', async ({
  page,
  harnessUrl,
}) => {
  const recipient = {
    ...admin.members[0],
    userId: 'user_confirmation_recipient',
    membershipId: 'membership_confirmation_recipient',
    displayName: 'Synthetic recipient',
    email: 'recipient@example.invalid',
    isOwner: false,
  };
  await openSettings(page, harnessUrl, (route) =>
    json(route, { data: { ...admin, members: [...admin.members, recipient] } }),
  );
  await page.getByRole('tab', { name: 'Ownership', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'New Owner', exact: true })
    .selectOption(recipient.userId);
  const phrase = page.getByRole('textbox', {
    name: 'Type Synthetic practice To Confirm',
    exact: true,
  });
  await phrase.fill('Synthetic practice');
  await page.getByRole('tab', { name: 'Invitations', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Leave without saving?', exact: true });
  await modal.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  await expect(phrase).toHaveValue('Synthetic practice');
  await page
    .getByRole('navigation', { name: 'Practice Navigation', exact: true })
    .getByRole('button', { name: 'Home', exact: true })
    .click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Keep Editing', exact: true }).click();
  await expect(phrase).toHaveValue('Synthetic practice');
  await expect(page.getByRole('combobox', { name: 'New Owner', exact: true })).toHaveValue(
    recipient.userId,
  );
});

test('ordinary saves keep the tab and unrelated draft mounted while refreshed data is pending', async ({
  page,
  harnessUrl,
}) => {
  let reads = 0,
    writes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openSettings(page, harnessUrl, async (route) => {
    if (route.request().method() === 'POST') {
      writes++;
      return json(route, { data: {} });
    }
    reads++;
    if (reads > 1) {
      await gate;
    }
    return json(route, { data: admin });
  });
  const draft = page
    .getByRole('group', { name: 'Add A Location', exact: true })
    .getByLabel('Name', { exact: true });
  await draft.fill('Synthetic work in progress');
  await page.getByRole('button', { name: 'Close Location', exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(draft).toHaveValue('Synthetic work in progress');
  await expect(draft).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Locations', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  for (const tab of await page.getByRole('tab').all()) {
    await expect(tab).toBeDisabled();
  }
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeDisabled();
  await expect(page.locator('.cq-a-loading')).toContainText('Updating Settings');
  release();
  await expect(draft).toBeEnabled();
  await expect(draft).toHaveValue('Synthetic work in progress');
  await page.getByRole('tab', { name: 'Team & Access', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Leave without saving?', exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
});

test('genuine owner-access loss clears settings and returns to newly checked Home', async ({
  page,
  harnessUrl,
}) => {
  let lost = false;
  await openSettings(
    page,
    harnessUrl,
    async (route) => {
      if (route.request().method() === 'POST') {
        lost = true;
        return json(
          route,
          { error: { code: 'OWNER_REQUIRED', message: 'Owner access required.' } },
          403,
        );
      }
      return json(route, { data: admin });
    },
    () => (lost ? { ...context, management: { locations: false, members: false } } : context),
  );
  await page.getByRole('button', { name: 'Close Location', exact: true }).click();
  await expect(page.locator('.cq-app-home')).toBeVisible();
  await expect(page.locator('.cq-settings')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Manage Team & Locations', exact: true }),
  ).toHaveCount(0);
});
