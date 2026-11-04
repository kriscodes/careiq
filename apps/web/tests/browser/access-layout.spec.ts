import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from './harness';
import type { AccessContext } from '../../src/lib/api/practice';

const location = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Main location',
  timeZone: 'America/Los_Angeles',
  status: 'active' as const,
};
const access: AccessContext = {
  userId: 'user_test',
  orgId: 'org_test',
  practice: {
    id: 'practice_test',
    name: 'Test practice',
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
  locations: [location],
};
const admin = {
  locations: [location],
  members: [
    {
      userId: 'user_test',
      membershipId: 'membership_test',
      isOwner: true,
      role: 'org:admin',
      status: 'active',
      locationIds: [location.id],
    },
  ],
  invitations: [],
  allowedRoles: ['org:member', 'org:admin'],
  ownerAccess: { disabledPermissions: [], allLocations: true, revision: 0 },
};
const copy = {
  en: {
    home: 'Hello again.',
    ownerAction: 'My Workspace Access',
    language: 'Interface Language',
    account: 'Your Account',
    help: 'Need A Hand?',
    where: 'Where are you working?',
    owner: 'My Workspace Access',
    back: '← Back To Your Practice',
    invite: 'Invite Your Team',
    inviteTitle: 'Invite A Teammate',
    later: 'I’ll Do This Later',
    role: 'Your owner role stays the same. You can return here to restore any area or location, even when all are turned off.',
  },
  es: {
    home: 'Hola de nuevo.',
    ownerAction: 'Mi Acceso Al Espacio De Trabajo',
    language: 'Idioma De La Interfaz',
    account: 'Tu Cuenta',
    help: '¿Te Echamos Una Mano?',
    where: '¿Dónde vas a trabajar?',
    owner: 'Mi Acceso Al Espacio De Trabajo',
    back: '← Volver A Tu Clínica',
    invite: 'Invita A Tu Equipo',
    inviteTitle: 'Invitar A Un Compañero',
    later: 'Lo Haré Más Tarde',
    role: 'Tu rol de propietario sigue siendo el mismo. Puedes volver aquí para restaurar cualquier área o sede, aunque todas estén desactivadas.',
  },
};
const json = (route: Route, data: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
const calls = (page: Page) => page.evaluate(() => window.__careiqMockCalls || []);

async function bounds(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}
async function expectHeader(page: Page, width: number, locale: 'en' | 'es') {
  const text = copy[locale];
  const header = page.locator('.cq-a-header');
  const language = header.getByRole('combobox', { name: text.language, exact: true });
  const account = header.getByRole('group', { name: text.account, exact: true });
  const trigger = account.getByRole('button', { name: 'Test account', exact: true });
  const help = header.getByRole('button', { name: text.help, exact: true });
  await expect(language).toBeVisible();
  await expect(trigger).toBeVisible();
  await expect(help).toBeVisible();
  const [brandBox, languageBox, accountBox, helpBox] = await Promise.all([
    bounds(header.locator('.cq-a-brand')),
    bounds(language),
    bounds(trigger),
    bounds(help),
  ]);
  for (const box of [brandBox, languageBox, accountBox, helpBox]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(languageBox.x + languageBox.width).toBeLessThanOrEqual(accountBox.x);
  expect(accountBox.x + accountBox.width).toBeLessThanOrEqual(helpBox.x);
  const centers = [languageBox, accountBox, helpBox].map((box) => box.y + box.height / 2);
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
  if (width > 480) {
    expect(Math.abs(brandBox.y + brandBox.height / 2 - centers[0])).toBeLessThanOrEqual(2);
  } else {
    expect(brandBox.y + brandBox.height).toBeLessThanOrEqual(languageBox.y);
    expect(Math.abs(brandBox.x - languageBox.x)).toBeLessThanOrEqual(1);
  }
  // Clerk roots used for full-page forms must not expand the avatar control.
  const providerRoot = await bounds(account.locator('.cl-rootBox'));
  expect(providerRoot.width).toBeLessThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function expectApplicationHome(page: Page, width: number, locale: 'en' | 'es') {
  const frame = page.locator('.cq-application-frame');
  const language = frame
    .locator('.wf-topbar')
    .getByRole('combobox', { name: copy[locale].language, exact: true });
  const account = frame
    .locator('.wf-sidebar')
    .getByRole('group', { name: copy[locale].account, exact: true });
  const trigger = account.getByRole('button', { name: 'Test account', exact: true });
  const navigation = frame.getByRole('navigation', {
    name: locale === 'es' ? 'Navegación De La Clínica' : 'Practice Navigation',
    exact: true,
  });
  if (!(await navigation.isVisible())) {
    await page
      .getByRole('button', {
        name: locale === 'es' ? 'Expandir Navegación' : 'Expand Navigation',
        exact: true,
      })
      .click();
  }
  await expect(language).toBeVisible();
  await expect(trigger).toBeVisible();
  await expect(navigation).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  for (const control of [language, trigger, frame.locator('.wf-nav-toggle')]) {
    const box = await bounds(control);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect((await bounds(account.locator('.cl-rootBox'))).width).toBeLessThanOrEqual(44);
  await expect(frame).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(language).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(
    await frame.evaluate((element) => {
      const scheme = getComputedStyle(element).colorScheme;
      return scheme.includes('light') && !scheme.includes('dark');
    }),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function expectWhite(page: Page) {
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.cq-access')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  for (const input of await page.locator('.cq-a-input, .cq-language-select').all()) {
    await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  expect(
    await page.evaluate(() =>
      [document.documentElement, document.body, document.querySelector('.cq-access')!].every(
        (element) => {
          const scheme = getComputedStyle(element).colorScheme;
          return scheme.includes('light') && !scheme.includes('dark');
        },
      ),
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname)) {
      return route.abort('blockedbyclient');
    }
    await route.continue();
  });
});

for (const width of [1280, 320]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'es'] as const) {
      test(`access header and owner guidance stay usable at ${width}px, ${colorScheme} system theme, ${locale}`, async ({
        page,
        harnessUrl,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        const requests: string[] = [];
        await page.route('**/api/v1/**', async (route) => {
          requests.push(route.request().method() + ' ' + new URL(route.request().url()).pathname);
          return json(route, {
            data: new URL(route.request().url()).pathname === '/api/v1/me' ? access : admin,
          });
        });
        await page.goto(`${harnessUrl}/?component=workspace`);
        await expect(page.getByRole('heading', { name: copy.en.home, exact: true })).toBeVisible();
        if (locale === 'es') {
          await page
            .getByRole('combobox', { name: copy.en.language, exact: true })
            .selectOption('es');
        }
        await page.evaluate(() => document.fonts.ready);
        await expect(
          page.getByRole('heading', { name: copy[locale].home, exact: true }),
        ).toBeVisible();
        await expectApplicationHome(page, width, locale);
        await page.getByRole('button', { name: copy[locale].ownerAction, exact: true }).click();
        await expect(
          page.getByRole('heading', { name: copy[locale].owner, exact: true }),
        ).toBeVisible();
        await expect(page.getByRole('checkbox', { name: /Main location/ })).toBeChecked();
        await expectApplicationHome(page, width, locale);
        await expectWhite(page);
        await expect(page.locator('.cq-a-header')).toHaveCount(0);
        const help = page.getByText(copy[locale].role, { exact: true });
        await expect(help).toHaveCSS('color', 'rgb(83, 100, 115)');
        await expect(help).not.toHaveAttribute('role');
        await expect(help).not.toHaveAttribute('tabindex');
        await expect(page.locator('form.cq-a-form')).toHaveAttribute(
          'aria-describedby',
          (await help.getAttribute('id')) || 'missing',
        );
        await expect(page.locator('main .cq-a-link')).toHaveCount(1);
        const back = page.getByRole('button', { name: copy[locale].back, exact: true });
        await expect(back).toBeVisible();
        await back.click();
        await expect(
          page.getByRole('heading', { name: copy[locale].home, exact: true }),
        ).toBeVisible();
        await page.getByRole('button', { name: copy[locale].invite, exact: true }).click();
        await expect(
          page.getByRole('heading', { name: copy[locale].inviteTitle, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: copy[locale].later, exact: true }),
        ).toBeVisible();
        await expect(page.getByText(copy[locale].role, { exact: true })).toHaveCount(0);
        await expectApplicationHome(page, width, locale);
        await expectWhite(page);
        await page.getByRole('button', { name: copy[locale].later, exact: true }).click();
        await expect(
          page.getByRole('heading', { name: copy[locale].home, exact: true }),
        ).toBeVisible();
        expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
        expect(
          (await calls(page)).filter((call) =>
            ['setActive', 'acceptInvitation'].includes(call.name),
          ),
        ).toHaveLength(0);
      });
    }
  }
}

test('invite still submits the chosen email, role and location and shows confirmation', async ({
  page,
  harnessUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const invitations: unknown[] = [];
  await page.route('**/api/v1/**', async (route) => {
    if (route.request().method() === 'POST') {
      invitations.push(route.request().postDataJSON());
      return json(route, { data: {} });
    }
    return json(route, { data: admin });
  });
  await page.goto(`${harnessUrl}/?component=invite`);
  await page.getByLabel('Work Email', { exact: true }).fill('synthetic@example.invalid');
  await page.getByLabel('Role', { exact: true }).selectOption('org:admin');
  await page.getByRole('checkbox', { name: /Main location/ }).check();
  await page.getByRole('button', { name: 'Send Invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invitation Sent', exact: true })).toBeVisible();
  expect(invitations).toEqual([
    { email: 'synthetic@example.invalid', role: 'org:admin', locationIds: [location.id] },
  ]);
  await expect(
    page.getByRole('button', { name: 'Back To Your Practice', exact: true }),
  ).toBeVisible();
  await expectHeader(page, 320, 'en');
  await expectWhite(page);
});
