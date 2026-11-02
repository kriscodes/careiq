import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort("blockedbyclient"));
});

async function go(page: Page, name: string, locale = "en") {
  const navigation = page.getByRole("navigation", { name: locale === "es" ? "Navegación De La Clínica" : "Practice Navigation", exact: true });
  if (!await navigation.isVisible()) await page.getByRole("button", { name: locale === "es" ? "Expandir Navegación" : "Expand Navigation", exact: true }).click();
  await navigation.getByRole("button", { name, exact: true }).click();
}
async function capture(page: Page, name: string) {
  if (!process.env.CAREIQ_SCHEDULING_SCREENSHOTS) return;
  await mkdir(process.env.CAREIQ_SCHEDULING_SCREENSHOTS, { recursive: true });
  // Keyboard focus can scroll the document; reset sticky navigation before capture.
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: resolve(process.env.CAREIQ_SCHEDULING_SCREENSHOTS, `${name}.png`), fullPage: true });
}
const planner = (page: Page) => page.getByRole("region", { name: "Weekly Appointment Calendar", exact: true });
async function readyPlanner(page: Page) {
  await expect(planner(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".wf-planner-event")).toHaveCount(6);
}
async function findTime(page: Page) {
  await readyPlanner(page);
  await page.getByRole("button", { name: "Find A Time", exact: true }).click();
  const search = page.locator("#appointment-availability");
  await search.getByRole("combobox", { name: "Provider", exact: true }).selectOption("dr2");
  return search;
}

test("Today keeps its local day and queue after browsing a different appointment week", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=scheduling`);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.locator(".wf-today-visit")).toHaveCount(5);
  await expect(page.locator(".wf-today-queue")).toContainText("Oct 16");
  await expect(page.getByLabel("Day", { exact: true })).toHaveCount(0);
  await expect(page.locator(".wf-today-queue")).not.toContainText("Weekly Witness");
  await go(page, "Appointments"); await readyPlanner(page);
  await expect(page.locator(".wf-planner-event").filter({ hasText: "Weekly Witness" })).toHaveCount(1);
  await page.getByLabel("Jump To Date", { exact: true }).fill("2026-11-02");
  await expect(page.getByRole("heading", { name: "No Appointments This Week", exact: true })).toBeVisible();
  await go(page, "Today");
  await expect(page.locator(".wf-today-visit")).toHaveCount(5);
  await expect(page.locator(".wf-today-queue")).toContainText("Oct 16");
  await expect(page.getByRole("button", { name: "Refresh Today", exact: true })).toBeEnabled();
  await capture(page, "today-en-desktop");
});

test("Appointments filters providers and preserves a selected visit through keyboard detail use", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=scheduling&initialView=Schedule`);
  await readyPlanner(page);
  await page.getByLabel("Provider", { exact: true }).selectOption("dr1");
  await expect(page.locator(".wf-planner-event")).toHaveCount(3);
  await expect(page.locator(".wf-planner-event").filter({ hasText: "Weekly Witness" })).toHaveCount(0);
  const visit = page.locator(".wf-planner-event").filter({ hasText: "Alex Morgan" });
  await visit.focus(); await page.keyboard.press("Enter");
  await expect(visit).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Visit Details", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Appointment Details", exact: true }).click();
  await expect(page.getByLabel("Provider", { exact: true })).toHaveValue("dr1");
  await expect(page.getByLabel("Jump To Date", { exact: true })).toHaveValue("2026-10-16");
  await expect(page.locator(".wf-planner-event")).toHaveCount(3);
  await capture(page, "appointments-en-desktop");
});

test("only checked availability offers slots and booking keeps the selected provider, day and duration", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=scheduling&initialView=Schedule`);
  const search = await findTime(page);
  await expect(search.getByRole("button", { name: /^Book This Time:/ })).toHaveCount(0);
  await search.getByLabel("Date", { exact: true }).fill("2026-10-17");
  await search.getByLabel("Duration In Minutes", { exact: true }).fill("60");
  await search.getByRole("button", { name: "Check Availability", exact: true }).click();
  await search.getByRole("button", { name: /^Book This Time:/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Provider", { exact: true })).toHaveValue("dr2");
  await expect(dialog.getByLabel("Date And Time", { exact: true })).toHaveValue("2026-10-17T09:00");
  await expect(dialog.getByLabel("Duration In Minutes", { exact: true })).toHaveValue("60");
  await dialog.getByLabel("Patient", { exact: true }).selectOption("p1");
  await dialog.getByRole("button", { name: "Book Appointment", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const calls = await page.evaluate(() => window.__careiqMockCalls);
  const request = calls.find(call => call.name === "workflowDetail")?.input as { resource: string };
  const query = new URLSearchParams(request.resource.split("?")[1]);
  expect(Object.fromEntries(query)).toEqual({ providerId: "dr2", date: "2026-10-17", durationMinutes: "60" });
  expect(calls.find(call => call.name === "workflowCommand")?.input).toMatchObject({ resource: "appointments", body: { providerId: "dr2", patientId: "p1", scheduledAt: "2026-10-17T16:00:00.000Z", endsAt: "2026-10-17T17:00:00.000Z" } });
});

for (const state of ["empty", "error"] as const) test(`availability ${state} has no fabricated booking suggestions`, async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=scheduling-availability-${state}&initialView=Schedule`);
  const search = await findTime(page);
  await search.getByRole("button", { name: "Check Availability", exact: true }).click();
  if (state === "empty") await expect(search.getByText("No available times match this search. Try another date or provider.", { exact: true })).toBeVisible();
  else await expect(search.getByRole("alert")).toBeVisible();
  await expect(search.getByRole("button", { name: /^Book This Time:/ })).toHaveCount(0);
  await expect(search.getByRole("button", { name: "Check Availability", exact: true })).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a delayed availability result is discarded when the provider changes", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=scheduling-availability-stale&initialView=Schedule`);
  const search = await findTime(page);
  await search.getByRole("button", { name: "Check Availability", exact: true }).click();
  await expect(search.getByRole("button", { name: "Checking…", exact: true })).toBeDisabled();
  await search.getByRole("combobox", { name: "Provider", exact: true }).selectOption("dr1");
  await page.evaluate(() => window.__careiqSchedulingFixture!.releaseAvailability());
  await expect(search.getByRole("button", { name: "Check Availability", exact: true })).toBeEnabled();
  await expect(search.getByRole("button", { name: /^Book This Time:/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowDetail").length)).toBe(1);
});

test("read-only staff can browse appointments without booking or checking reservable slots", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=readonly&initialView=Schedule`);
  await expect(planner(page)).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".wf-planner-event")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Find A Time", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Book Appointment/ })).toHaveCount(0);
  await page.getByLabel("Provider", { exact: true }).selectOption("dr1");
  await expect(page.locator(".wf-planner-event")).toHaveCount(3);
});

for (const revocation of ["http", "capabilities"] as const) test(`cached weekly records disappear after base snapshot ${revocation} revocation`, async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=scheduling-revoked-${revocation}&initialView=Schedule`);
  await readyPlanner(page);
  await expect(page.locator(".wf-planner-event").filter({ hasText: "Weekly Witness" })).toHaveCount(1);
  const before = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowLoad").length);
  await page.evaluate(() => window.__careiqSchedulingFixture!.revoke());
  // The week key remains identical, leaving the previously loaded week cached.
  await page.getByLabel("Jump To Date", { exact: true }).fill("2026-10-15");
  await expect(page.locator(".wf-planner")).toHaveCount(0);
  await expect(page.getByText("Weekly Witness", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Alex Morgan", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowLoad").length)).toBe(before + 1);
});

for (const locale of ["en", "es"] as const) test(`Today and the weekly agenda fit 320px in ${locale}`, async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${harnessUrl}/?component=workflow&scenario=scheduling`);
  if (locale === "es") await page.getByRole("combobox", { name: "Interface Language", exact: true }).selectOption("es");
  await expect(page.locator(".wf-today-visit")).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, `today-${locale}-320`);
  await go(page, locale === "es" ? "Citas" : "Appointments", locale);
  const calendar = page.getByRole("region", { name: locale === "es" ? "Calendario Semanal De Citas" : "Weekly Appointment Calendar", exact: true });
  await expect(calendar).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".wf-planner-agenda-event")).toHaveCount(6);
  await expect(page.locator(".wf-planner-agenda")).toBeVisible();
  await expect(page.locator(".wf-planner-desktop")).not.toBeVisible();
  await page.getByRole("button", { name: locale === "es" ? "Buscar Horario" : "Find A Time", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await capture(page, `appointments-${locale}-320`);
});
