import { test, expect } from './harness';

test('manager activity is part of the existing dashboard and separates action day from appointment day', async ({
  page,
  harnessUrl,
}, testInfo) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole('button', { name: 'Manager', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
  await expect(page.getByLabel('Activity Day', { exact: true })).toHaveValue('2026-10-16');
  await expect(page.locator('.ci-team-activity-list')).toContainText('Appointment Created');
  await page.screenshot({
    path: testInfo.outputPath('careiq-manager-activity-desktop.png'),
    fullPage: true,
  });
  await page.getByLabel('Appointment Day', { exact: true }).fill('2026-10-17');
  await expect(page.getByLabel('Activity Day', { exact: true })).toHaveValue('2026-10-16');
  await expect(page.locator('.ci-team-activity-list')).toContainText('Appointment Created');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('careiq-manager-activity-320-en.png'),
    fullPage: true,
  });
  await page.evaluate(() => {
    localStorage.setItem('careiq-staff-locale', 'es');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'careiq-staff-locale', newValue: 'es' }),
    );
  });
  await expect(
    page.getByRole('heading', { name: 'Actividad Del Equipo', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('careiq-manager-activity-320-es.png'),
    fullPage: true,
  });
});

test('team activity person/type filters and counts apply before pagination, including historical actors', async ({
  page,
  harnessUrl,
}) => {
  await page.goto(`${harnessUrl}/?component=manager-activity`);
  await expect(page.getByLabel('Activity Day', { exact: true })).toHaveValue('2026-11-01');
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(50);
  await expect(page.locator('.ci-team-activity-list [title="synthetic-record-0"]')).toContainText(
    'Appointment · #record-0',
  );
  await expect(page.locator('.ci-activity-count')).toContainText(
    '50 of 52 matching actions loaded',
  );
  await page.getByRole('button', { name: 'Load More Activity', exact: true }).click();
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(52);
  await page.getByLabel('Performed By', { exact: true }).selectOption('user_historical_staff');
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(26);
  await page.getByLabel('Action Type', { exact: true }).selectOption('insurance');
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(9);
  await expect(page.locator('.ci-activity-count')).toContainText('9 of 9 matching actions loaded');
  await expect(page.locator('.ci-team-activity-list')).toContainText('Inactive Coverage');
  await expect(page.locator('.ci-team-activity-list')).not.toContainText('denied');
  await expect(page.getByLabel('Performed By', { exact: true }).locator('option')).toHaveCount(3);
  await expect
    .poll(() => page.evaluate(() => window.__careiqActivityCalls?.at(-1)))
    .toMatchObject({
      from: '2026-11-01',
      to: '2026-11-01',
      actorId: 'user_historical_staff',
      category: 'insurance',
    });
});

test('activity clears stale rows across action day changes and ignores a late prior response', async ({
  page,
  harnessUrl,
}) => {
  await page.goto(`${harnessUrl}/?component=manager-activity&scenario=activity-stale`);
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(50);
  await page.getByLabel('Activity Day', { exact: true }).fill('2026-11-02');
  await expect(page.getByRole('status')).toContainText('Loading team activity');
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(0);
  await page.getByLabel('Activity Day', { exact: true }).fill('2026-11-03');
  await expect(
    page.getByRole('heading', { name: 'No Matching Team Activity', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Release previous activity', exact: true }).click();
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(0);
  await expect(page.locator('.ci-activity-count')).toContainText('0 of 0');
});

test('activity retry recovers from a failed read and pagination retry preserves loaded rows', async ({
  page,
  harnessUrl,
}) => {
  await page.goto(`${harnessUrl}/?component=manager-activity&scenario=activity-error`);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(50);
  await page.goto(`${harnessUrl}/?component=manager-activity&scenario=activity-more-error`);
  await page.getByRole('button', { name: 'Load More Activity', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load More Activity', exact: true }).click();
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(52);
});

test('activity visibility follows current permission and fits narrow English and Spanish layouts', async ({
  page,
  harnessUrl,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${harnessUrl}/?component=manager-activity`);
  await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Toggle activity permission', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Team Activity', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Toggle activity permission', exact: true }).click();
  await expect(page.locator('.ci-team-activity-list > li')).toHaveCount(50);
  await page.evaluate(() => {
    localStorage.setItem('careiq-staff-locale', 'es');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'careiq-staff-locale', newValue: 'es' }),
    );
  });
  await expect(
    page.getByRole('heading', { name: 'Actividad Del Equipo', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Día De Actividad', { exact: true })).toHaveValue('2026-11-01');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
