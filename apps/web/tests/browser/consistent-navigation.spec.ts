import { resolve } from "node:path";
import type { Page, Route } from "@playwright/test";
import { test, expect } from "./harness";

const location = { id: "11111111-1111-4111-8111-111111111111", name: "Synthetic main location", timeZone: "UTC", status: "active" };
const profile = { disabledPermissions: [] as string[], allLocations: true, revision: 0 };
const capabilities = { patientsRead: true, patientsCreate: true, patientsUpdate: true, appointmentsRead: true, appointmentsCreate: true, appointmentsUpdate: true, documentsRead: true, documentsUpload: true, documentsReview: true, documentsArchive: true, requestsSend: true, requirementsWaive: true, requirementsManage: true, workManage: true, activityRead: true, configurationManage: true, paperworkManage: true };
const owner = { userId: "user_test", membershipId: "member_owner", displayName: "Synthetic owner", email: "owner@example.invalid", role: "org:admin", status: "active", locationIds: [location.id], isOwner: true };
const teammate = { ...owner, userId: "user_teammate", membershipId: "member_teammate", displayName: "Synthetic teammate", email: "teammate@example.invalid", isOwner: false, role: "org:member" };
const context = { userId: owner.userId, orgId: "org_test", practice: { id: "practice_test", name: "Synthetic practice", authorizationMode: "location", status: "active" }, onboarding: "ready", enrollmentStatus: "active", capabilities: { patients: { read: true, create: true }, appointments: { read: true, create: true } }, workspaceCapabilities: { patientsRead: true, appointmentsRead: true, documentsRead: true, configurationManage: true }, management: { locations: true, members: true }, ownerAccess: profile, locations: [location] };
const admin = { locations: [location], members: [owner, teammate], invitations: [], allowedRoles: ["org:member", "org:admin"], ownerAccess: profile };
const snapshot = { location, timeZone: "UTC", patients: [], appointments: [], documents: [], templates: [], requests: [], workItems: [], providers: [], visitTypes: [], documentTypes: [], capabilities, asOf: "2026-10-31T12:00:00Z" };
const account = { account: { status: "active", archiveRequestedAt: null, archivedAt: null, restoredAt: null }, ownedPractices: [], closureRequest: null };
const labels = {
  en: { navigation: "Practice navigation", primary: ["Home", "Today", "Appointments", "Patients", "Documents", "Templates", "Manager", "Insurance", "Patient delivery", "Notifications", "Practice"], footer: ["View invitations", "Personal account", "Audit review"], expand: "Expand navigation", collapse: "Collapse navigation", workspace: "Workspace", language: "Interface language", account: "Your account", home: "Hello again.", practice: "Practice", tabs: ["Locations", "Team & access", "Invitations", "Ownership"] },
  es: { navigation: "Navegación de la clínica", primary: ["Inicio", "Hoy", "Citas", "Pacientes", "Documentos", "Plantillas", "Gerencia", "Seguros", "Envíos a pacientes", "Notificaciones", "Clínica"], footer: ["Ver invitaciones", "Cuenta personal", "Revisión de auditoría"], expand: "Expandir navegación", collapse: "Contraer navegación", workspace: "Espacio de trabajo", language: "Idioma de la interfaz", account: "Tu cuenta", home: "Hola de nuevo.", practice: "Clínica", tabs: ["Sedes", "Equipo y acceso", "Invitaciones", "Propiedad"] },
};
type Locale = keyof typeof labels;
const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, json: data });
const paths = (route: Route) => new URL(route.request().url()).pathname;
const nav = (page: Page, locale: Locale = "en") => page.getByRole("navigation", { name: labels[locale].navigation, exact: true });
const frame = (page: Page) => page.locator(".cq-application-frame");
const mockCalls = (page: Page) => page.evaluate(() => window.__careiqMockCalls || []);
async function capture(page: Page, name: string) { const directory = process.env.CAREIQ_NAVIGATION_SCREENSHOTS; if (directory) await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true }); }
async function menu(page: Page, locale: Locale = "en") {
  await expect(frame(page)).toBeVisible();
  if (!await nav(page, locale).isVisible()) await page.getByRole("button", { name: labels[locale].expand, exact: true }).click();
  await expect(nav(page, locale)).toBeVisible();
}
async function go(page: Page, name: string, locale: Locale = "en") {
  await menu(page, locale);
  await frame(page).locator(".wf-sidebar").getByRole("button", { name, exact: true }).click();
}
async function expectShell(page: Page, active: string, locale: Locale = "en", ownerAccess = true, locationMode = true) {
  await menu(page, locale);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("navigation")).toHaveCount(1);
  const expected = labels[locale].primary.filter((_, index) => (ownerAccess || index !== 10) && (locationMode || index < 4 || index === 10));
  const buttons = nav(page, locale).getByRole("button");
  await expect(buttons).toHaveCount(expected.length);
  for (const [index, name] of expected.entries()) await expect(buttons.nth(index)).toHaveAccessibleName(name);
  await expect(frame(page).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(frame(page).locator('[aria-current="page"]')).toHaveAccessibleName(active);
  await expect(frame(page).locator(".wf-sidebar").getByRole("combobox", { name: labels[locale].workspace, exact: true, includeHidden: true })).toHaveValue("org_test");
  await expect(frame(page).getByRole("group", { name: labels[locale].account, exact: true }).getByRole("button", { name: "Test account", exact: true })).toBeVisible();
  for (const name of labels[locale].footer) await expect(frame(page).locator(".wf-sidebar").getByRole("button", { name, exact: true, includeHidden: true })).toHaveCount(1);
}
async function api(page: Page, options: { current?: () => unknown; account?: unknown; handle?: (route: Route) => Promise<void> | undefined } = {}) {
  const requests: { method: string; path: string }[] = [];
  await page.route("**/api/v1/**", async route => {
    const path = paths(route); requests.push({ method: route.request().method(), path });
    if (path === "/api/v1/me") {
      const organization = await page.evaluate(() => window.__careiqLastActivation?.organization ?? "org_test");
      const value = options.current?.() ?? context;
      return json(route, { data: organization === "org_other" ? { ...context, orgId: organization, practice: { ...context.practice, id: "practice_other", name: "Another practice" } } : value });
    }
    const custom = options.handle?.(route); if (custom) return custom;
    if (path === "/api/v1/practice/admin") return json(route, { data: admin });
    if (path === "/api/v1/account") return json(route, { data: options.account ?? account });
    if (path.endsWith("/workflow")) return json(route, { data: snapshot });
    if (path.endsWith("/workflow/appointments")) return json(route, { data: [], pagination: { hasMore: false, nextCursor: null } });
    if (path.endsWith("/workflow/notifications")) return json(route, { data: { items: [], unreadCount: 0, attentionCount: 0, snapshotToken: "synthetic-snapshot", pagination: { hasMore: false, nextCursor: null } } });
    if (path.endsWith("/communications/deliveries")) return json(route, { data: { items: [], asOf: snapshot.asOf } });
    if (path.endsWith("/communications/readiness")) return json(route, { data: { enabled: false, channels: { email: { ready: false }, sms: { ready: false } }, reasonCode: "DELIVERY_DISABLED" } });
    if (path.endsWith("/insurance/manager")) return json(route, { data: { from: "2026-10-31", to: "2026-11-06", summary: { appointments: 0, tracked: 0, untracked: 0, active: 0, inactive: 0, unverified: 0, needsFollowUp: 0, overdue: 0, unassigned: 0 }, team: [] } });
    if (path.endsWith("/insurance/assignees")) return json(route, { data: [] });
    if (path.endsWith("/insurance/cases")) return json(route, { data: [], pagination: { hasMore: false, nextCursor: null }, meta: { capabilities: { read: true, manage: true, evidence: true, activity: true } } });
    throw new Error(`Unexpected synthetic navigation request: ${route.request().method()} ${path}`);
  });
  return requests;
}
test.beforeEach(async ({ page }) => { await page.route("**/*", route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()); });

test("an owner keeps one ordered menu, picker, account and current marker across every management page", async ({ page, harnessUrl }) => {
  const requests = await api(page, { account: { ...account, ownedPractices: [{ id: context.practice.id, name: context.practice.name }] } });
  await page.goto(`${harnessUrl}/?component=workspace`); await expectShell(page, "Home");
  const frameTop = (await frame(page).boundingBox())!.y;
  for (const control of [frame(page).locator(".wf-sidebar-foot"), frame(page).locator(".cl-userButtonTrigger")]) { const box = (await control.boundingBox())!; expect(box.y).toBeGreaterThanOrEqual(frameTop); expect(box.y + box.height - frameTop).toBeLessThanOrEqual(page.viewportSize()!.height); }
  // The fixture banner is outside the production frame's viewport height.
  await nav(page).getByRole("button", { name: "Practice", exact: true }).scrollIntoViewIfNeeded(); await expect(nav(page).getByRole("button", { name: "Practice", exact: true })).toBeInViewport();
  await nav(page).evaluate(element => { element.scrollTop = 0; });
  await capture(page, "home-desktop");
  await go(page, "Practice");
  await expect.poll(() => nav(page).locator('[aria-current="page"]').evaluate(element => { const menu = element.closest("nav")!.getBoundingClientRect(), item = element.getBoundingClientRect(); return Math.min(item.bottom, menu.bottom) > Math.max(item.top, menu.top) && Math.min(item.right, menu.right) > Math.max(item.left, menu.left); })).toBe(true);
  await capture(page, "practice-desktop");
  for (const tab of labels.en.tabs) { await page.getByRole("tab", { name: tab, exact: true }).click(); await expectShell(page, "Practice"); }
  await page.getByRole("tab", { name: "Team & access", exact: true }).click(); await page.getByRole("button", { name: "My workspace access", exact: true }).click(); await expectShell(page, "Practice");
  await go(page, "Home"); await page.getByRole("button", { name: "Invite your team", exact: true }).click(); await expect(page.getByRole("heading", { name: "Invite a teammate", exact: true })).toBeVisible(); await expectShell(page, "Practice");
  for (const name of labels.en.footer) { await go(page, name); await expectShell(page, name); }
  await go(page, "Home"); await expect(page.getByRole("heading", { name: labels.en.home, exact: true })).toBeVisible();
  expect(requests.every(request => request.method === "GET" && !request.path.includes("/workflow") && !request.path.includes("/audit/"))).toBe(true);
});

test("the same canonical menu stays in the real workspace for every operational section", async ({ page, harnessUrl }) => {
  const requests = await api(page); await page.goto(`${harnessUrl}/?component=workspace`);
  await go(page, "Patients"); await page.getByRole("button", { name: /^Continue/ }).click();
  for (const name of labels.en.primary.slice(1, 10)) { await go(page, name); await expectShell(page, name); if (name === "Patients") await capture(page, "patients-desktop"); }
  await go(page, "Practice"); await expectShell(page, "Practice"); await expect(page.getByRole("tabpanel", { name: "Locations", exact: true })).toBeVisible();
  expect(requests.some(request => request.path.endsWith("/workflow"))).toBe(true); expect(requests.every(request => request.method === "GET")).toBe(true);
});

for (const locale of ["en", "es"] as const) test(`the shared drawer preserves order and white surfaces across pages at 320px dark in ${locale}`, async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width: 320, height: 850 }); await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); await api(page);
  await page.goto(`${harnessUrl}/?component=workspace`); if (locale === "es") await page.getByRole("combobox", { name: labels.en.language, exact: true }).selectOption("es");
  for (const name of [labels[locale].primary[0], labels[locale].practice, ...labels[locale].footer]) {
    await go(page, name, locale); if (name === labels[locale].practice) await capture(page, `practice-mobile-${locale}-closed`); await expectShell(page, name, locale); if (name === labels[locale].practice) await capture(page, `practice-mobile-${locale}-open`); await expect(frame(page)).toHaveCSS("background-color", "rgb(255, 255, 255)"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: labels[locale].collapse, exact: true }).click(); await expect(nav(page, locale)).not.toBeVisible();
  }
});

test("desktop collapsed navigation survives settings, owner access, inbox and account page changes", async ({ page, harnessUrl }) => {
  await api(page); await page.goto(`${harnessUrl}/?component=workspace`); await page.getByRole("button", { name: labels.en.collapse, exact: true }).click();
  await expect(page.locator(".wf-shell")).toHaveAttribute("data-collapsed", "true");
  for (const name of ["Practice", ...labels.en.footer, "Home"]) { await go(page, name); await expectShell(page, name); await expect(page.locator(".wf-shell")).toHaveAttribute("data-collapsed", "true"); }
});

for (const ownerAccess of [true, false]) test(`an active ${ownerAccess ? "self-limited owner" : "member"} keeps navigation without dispatching denied records`, async ({ page, harnessUrl }) => {
  const requests = await api(page, { current: () => ({ ...context, management: { locations: ownerAccess, members: ownerAccess }, capabilities: { patients: { read: false, create: false }, appointments: { read: false, create: false } }, workspaceCapabilities: { patientsRead: false, appointmentsRead: false, documentsRead: false, configurationManage: false }, locations: [] }) });
  await page.goto(`${harnessUrl}/?component=workspace`);
  for (const name of labels.en.primary.slice(0, 10)) { await go(page, name); await expectShell(page, name, "en", ownerAccess); }
  expect(requests).toEqual([{ method: "GET", path: "/api/v1/me" }]);
  await expect(nav(page).getByRole("button", { name: "Practice", exact: true })).toHaveCount(ownerAccess ? 1 : 0);
});

test("legacy staff retain the core menu without location-only operational destinations", async ({ page, harnessUrl }) => {
  await api(page, { current: () => ({ ...context, practice: { ...context.practice, authorizationMode: "legacy" }, management: { locations: false, members: false }, enrollmentStatus: null, locations: [] }) });
  await page.goto(`${harnessUrl}/?component=workspace`); await expectShell(page, "Home", "en", false, false);
  for (const name of ["Documents", "Templates", "Manager", "Insurance", "Patient delivery", "Notifications"]) await expect(nav(page).getByRole("button", { name, exact: true })).toHaveCount(0);
});

for (const status of ["pending_assignment", "suspended", "revoked"]) test(`${status} membership cannot gain the staff frame through an account or inbox visit`, async ({ page, harnessUrl }) => {
  const requests = await api(page, { current: () => ({ ...context, onboarding: "pending", enrollmentStatus: status, management: { locations: false, members: false }, locations: [] }) });
  await page.goto(`${harnessUrl}/?component=workspace`); await expect(page.getByRole("button", { name: "Personal account", exact: true })).toBeVisible(); await expect(frame(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Personal account", exact: true }).click(); await expect(page.getByRole("heading", { name: "Personal account", exact: true })).toBeVisible(); await expect(frame(page)).toHaveCount(0); await expect(nav(page)).toHaveCount(0);
  expect(requests.every(request => ["/api/v1/me", "/api/v1/account"].includes(request.path))).toBe(true);
});

test("a personal patient library and account never acquire staff navigation or dispatch practice reads", async ({ page, harnessUrl }) => {
  const paths: string[] = [];
  await page.route("**/api/v1/**", route => { const path = new URL(route.request().url()).pathname; paths.push(path); if (path === "/api/v1/account") return json(route, { data: account }); if (path.endsWith("communication-preferences")) return json(route, { data: { profiles: [] } }); return json(route, { data: { items: [], hasMore: false, nextCursor: null } }); });
  await page.goto(`${harnessUrl}/?component=patient-paperwork&scenario=no-active-organization`); await page.getByRole("button", { name: "Personal account", exact: true }).click(); await expect(page.getByRole("heading", { name: "Personal account", exact: true })).toBeVisible(); await expect(frame(page)).toHaveCount(1); await expect(nav(page)).toHaveCount(0);
  const care = page.getByRole("navigation", { name: "My care", exact: true }); await expect(care.getByRole("button")).toHaveText(["Your paperwork", "Personal account"]); await expect(care.locator('[aria-current="page"]')).toHaveAccessibleName("Personal account"); await expect(page.getByRole("main")).toHaveCount(1);
  await care.getByRole("button", { name: "Your paperwork", exact: true }).click(); await expect(care.getByRole("button")).toHaveText(["Your paperwork", "Personal account"]); await expect(care.locator('[aria-current="page"]')).toHaveAccessibleName("Your paperwork");
  expect(paths.every(path => path === "/api/v1/account" || path.startsWith("/api/v1/patient-paperwork"))).toBe(true);
});

for (const target of ["settings", "owner", "invite", "account"] as const) test(`the ${target} page queues navigation and preserves the draft until explicit discard`, async ({ page, harnessUrl }) => {
  await api(page, { current: target === "account" ? () => ({ ...context, management: { locations: false, members: false }, ownerAccess: undefined }) : undefined }); await page.goto(`${harnessUrl}/?component=workspace`);
  if (target === "settings") { await go(page, "Practice"); await page.getByRole("tabpanel", { name: "Locations", exact: true }).getByRole("textbox", { name: "Name", exact: true }).fill("Synthetic unsaved location"); }
  if (target === "owner") { await page.getByRole("button", { name: "My workspace access", exact: true }).click(); await page.getByRole("checkbox", { name: "Patients", exact: true }).uncheck(); }
  if (target === "invite") { await page.getByRole("button", { name: "Invite your team", exact: true }).click(); await page.getByRole("textbox", { name: "Work email", exact: true }).fill("unsaved@example.invalid"); }
  if (target === "account") { await go(page, "Personal account"); await page.getByRole("textbox", { name: "Type ARCHIVE to confirm", exact: true }).fill("ARC"); }
  await go(page, "Home"); const modal = page.getByRole("dialog", { name: "Leave without saving?", exact: true }); await expect(modal).toBeVisible(); await expect(modal.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
  await modal.getByRole("button", { name: "Keep editing", exact: true }).click();
  if (target === "settings") await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Synthetic unsaved location");
  if (target === "owner") await expect(page.getByRole("checkbox", { name: "Patients", exact: true })).not.toBeChecked();
  if (target === "invite") await expect(page.getByRole("textbox", { name: "Work email", exact: true })).toHaveValue("unsaved@example.invalid");
  if (target === "account") await expect(page.getByRole("textbox", { name: "Type ARCHIVE to confirm", exact: true })).toHaveValue("ARC");
  await go(page, "Home"); await modal.getByRole("button", { name: "Discard changes", exact: true }).click(); await expect(page.getByRole("heading", { name: labels.en.home, exact: true })).toBeVisible(); await expectShell(page, "Home", "en", target !== "account");
});

for (const target of ["settings", "owner", "invite", "account"] as const) test(`the ${target} pending save locks the shared menu and blocks duplicate actions`, async ({ page, harnessUrl }) => {
  let writes = 0, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await api(page, { current: target === "account" ? () => ({ ...context, management: { locations: false, members: false }, ownerAccess: undefined }) : undefined, handle: route => { if (route.request().method() !== "POST") return undefined; writes++; return gate.then(() => json(route, { data: paths(route) === "/api/v1/account/archive" ? { ...account.account, status: "archived" } : {} })); } });
  await page.goto(`${harnessUrl}/?component=workspace&scenario=navigation-two-practices`);
  let submit;
  if (target === "settings") { await go(page, "Practice"); await page.getByRole("textbox", { name: "Name", exact: true }).fill("Synthetic pending location"); submit = page.getByRole("button", { name: "Add location", exact: true }); }
  else if (target === "owner") { await page.getByRole("button", { name: "My workspace access", exact: true }).click(); submit = page.getByRole("button", { name: "Save my access", exact: true }); }
  else if (target === "invite") { await page.getByRole("button", { name: "Invite your team", exact: true }).click(); await page.getByRole("textbox", { name: "Work email", exact: true }).fill("pending@example.invalid"); submit = page.getByRole("button", { name: "Send invitation", exact: true }); }
  else { await go(page, "Personal account"); await page.getByRole("textbox", { name: "Type ARCHIVE to confirm", exact: true }).fill("ARCHIVE"); submit = page.getByRole("button", { name: "Archive my account", exact: true }); }
  await submit.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }); await expect.poll(() => writes).toBe(1);
  for (const button of await nav(page).getByRole("button").all()) await expect(button).toBeDisabled();
  for (const name of labels.en.footer) await expect(frame(page).locator(".wf-sidebar").getByRole("button", { name, exact: true, includeHidden: true })).toBeDisabled();
  expect(await frame(page).locator(".cl-userButtonTrigger").evaluate(element => Boolean(element.closest("[inert]")) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true")).toBe(true);
  expect(await frame(page).locator(".cq-practice-picker select").evaluate(element => Boolean(element.closest("[inert]")) || element.hasAttribute("disabled"))).toBe(true); await expect(frame(page).locator(".wf-nav-toggle")).toBeDisabled(); expect((await mockCalls(page)).filter(call => call.name === "setActive")).toEqual([]);
  release();
  if (target === "settings") await expect(page.getByRole("button", { name: "Add location", exact: true })).toBeEnabled();
  else if (target === "owner") await expect(page.getByRole("heading", { name: labels.en.home, exact: true })).toBeVisible();
  else if (target === "invite") await expect(page.getByRole("heading", { name: "Invitation sent", exact: true })).toBeVisible();
  else await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toBeVisible();
  expect(writes).toBe(1);
});

test("a provider-owned invitation acceptance locks the same navigation before the API continuation", async ({ page, harnessUrl }) => {
  const requests = await api(page); await page.goto(`${harnessUrl}/?component=workspace&scenario=navigation-invitation-pending`); await go(page, "View invitations"); await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  for (const button of await nav(page).getByRole("button").all()) await expect(button).toBeDisabled();
  for (const name of labels.en.footer) await expect(frame(page).locator(".wf-sidebar").getByRole("button", { name, exact: true, includeHidden: true })).toBeDisabled();
  expect(await frame(page).locator(".cl-userButtonTrigger").evaluate(element => Boolean(element.closest("[inert]")) || element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true")).toBe(true);
  expect((await mockCalls(page)).filter(call => call.name === "acceptInvitation")).toHaveLength(1); expect(requests.every(request => request.method === "GET")).toBe(true);
});

test("switching workspace from a dirty owner editor requires confirmation and never carries its draft into the next practice", async ({ page, harnessUrl }) => {
  await api(page); await page.goto(`${harnessUrl}/?component=workspace&scenario=navigation-two-practices`); await page.getByRole("button", { name: "My workspace access", exact: true }).click(); await page.getByRole("checkbox", { name: "Patients", exact: true }).uncheck();
  const picker = frame(page).locator(".cq-practice-picker select"); await picker.selectOption("org_other"); const modal = page.getByRole("dialog", { name: "Leave without saving?", exact: true }); await modal.getByRole("button", { name: "Keep editing", exact: true }).click(); await expect(picker).toHaveValue("org_test"); await expect(page.getByRole("checkbox", { name: "Patients", exact: true })).not.toBeChecked(); expect((await mockCalls(page)).filter(call => call.name === "setActive")).toEqual([]);
  await picker.selectOption("org_other"); await modal.getByRole("button", { name: "Discard changes", exact: true }).click(); await expect(page.getByRole("heading", { name: labels.en.home, exact: true })).toBeVisible(); await expect(frame(page).locator(".cq-practice-picker select")).toHaveValue("org_other"); await expect(page.getByRole("heading", { name: "My workspace access", exact: true })).toHaveCount(0);
  expect((await mockCalls(page)).filter(call => call.name === "setActive")).toEqual([{ name: "setActive", input: { organization: "org_other", hasNavigate: false } }]);
});


test("patient communication drafts stay private and require discard before personal-account navigation", async ({ page, harnessUrl }) => {
  const requests: string[] = [];
  const communication = { contextToken: "synthetic-context", revision: 1, practiceName: "Synthetic care team", locationName: "Synthetic location", endpoints: [{ id: "synthetic-destination", channel: "email", masked: "s•••@example.invalid", suppressed: false, paperworkEligible: true, choices: { request: true, reminder: true, paperwork: true } }] };
  await page.route("**/api/v1/**", route => {
    const path = paths(route); requests.push(`${route.request().method()} ${path}`);
    if (path === "/api/v1/account") return json(route, { data: account });
    if (path.endsWith("communication-preferences")) return json(route, { data: { profiles: [communication] } });
    return json(route, { data: { items: [], hasMore: false, nextCursor: null } });
  });
  await page.goto(`${harnessUrl}/?component=patient-paperwork&scenario=no-active-organization`);
  await page.getByRole("checkbox", { name: "Reminders", exact: true }).uncheck();
  const care = page.getByRole("navigation", { name: "My care", exact: true });
  await care.getByRole("button", { name: "Personal account", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Leave without saving?", exact: true }); await expect(modal).toBeVisible();
  await expect(modal.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused();
  await modal.getByRole("button", { name: "Keep editing", exact: true }).click(); await expect(page.getByRole("checkbox", { name: "Reminders", exact: true })).not.toBeChecked();
  await care.getByRole("button", { name: "Personal account", exact: true }).click(); await modal.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Personal account", exact: true })).toBeVisible(); await expect(care.locator('[aria-current="page"]')).toHaveAccessibleName("Personal account");
  await care.getByRole("button", { name: "Your paperwork", exact: true }).click(); await expect(page.getByRole("checkbox", { name: "Reminders", exact: true })).toBeChecked();
  expect(requests.every(request => request.startsWith("GET ") && !request.includes("/practice") && !request.includes("/workflow"))).toBe(true);
});


test("the real forms studio guards a shared Practice navigation change exactly once", async ({ page, harnessUrl }) => {
  const requests = await api(page); await page.goto(`${harnessUrl}/?component=workspace`); await go(page, "Templates"); await page.getByRole("button", { name: /^Continue/ }).click();
  await page.getByRole("button", { name: "＋ New form", exact: true }).click(); const studio = page.getByRole("region", { name: "Forms studio", exact: true });
  const title = studio.getByLabel("Form title", { exact: true }); await title.fill("Synthetic unsaved navigation form"); let prompts = 0;
  page.once("dialog", dialog => { prompts++; return dialog.dismiss(); }); await go(page, "Practice"); await expect(title).toHaveValue("Synthetic unsaved navigation form"); await expect(nav(page).locator('[aria-current="page"]')).toHaveAccessibleName("Templates"); expect(prompts).toBe(1);
  page.once("dialog", dialog => { prompts++; return dialog.accept(); }); await go(page, "Practice"); await expect(page.getByRole("heading", { name: "Practice settings", exact: true })).toBeVisible(); await expectShell(page, "Practice"); expect(prompts).toBe(2); expect(requests.every(request => request.method === "GET")).toBe(true);
});

test("an internal notification-bell change resumes the same current section after a fresh authorization check", async ({ page, harnessUrl }) => {
  const requests = await api(page); await page.goto(`${harnessUrl}/?component=workspace`); await go(page, "Today"); await page.getByRole("button", { name: /^Continue/ }).click();
  await page.locator(".wf-topbar .cq-bell").click(); await expect(nav(page).locator('[aria-current="page"]')).toHaveAccessibleName("Notifications");
  const before = requests.filter(request => request.path === "/api/v1/me").length;
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await expect(page.getByRole("heading", { name: "Your workspace is paused", exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await expect.poll(() => requests.filter(request => request.path === "/api/v1/me").length).toBe(before + 1);
  await expect(nav(page).locator('[aria-current="page"]')).toHaveAccessibleName("Notifications"); await expect(page.locator(".wf-page-head h1")).toHaveText("Notifications"); await expect(page.getByRole("heading", { name: "Hello again.", exact: true })).toHaveCount(0); expect(requests.every(request => request.method === "GET")).toBe(true);
});


test("a cancelled mobile navigation restores focus to its visible menu opener and preserves the settings draft", async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width: 320, height: 850 }); await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" }); const requests = await api(page);
  await page.goto(`${harnessUrl}/?component=workspace`); await go(page, "Practice"); const draft = page.getByRole("textbox", { name: "Name", exact: true }); await draft.fill("Synthetic mobile draft");
  await menu(page); const patients = nav(page).getByRole("button", { name: "Patients", exact: true }); await patients.click();
  const modal = page.getByRole("dialog", { name: "Leave without saving?", exact: true }); await expect(modal.getByRole("button", { name: "Keep editing", exact: true })).toBeFocused(); await modal.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(patients).toBeVisible(); await expect(patients).toBeFocused(); await expect(draft).toHaveValue("Synthetic mobile draft"); await expect(nav(page).getByRole("button", { name: "Practice", exact: true })).toHaveAttribute("aria-current", "page");
  await patients.click(); await modal.getByRole("button", { name: "Discard changes", exact: true }).click(); await expect(page.getByRole("heading", { name: "Where are you working?", exact: true })).toBeVisible(); await expect(nav(page)).not.toBeVisible(); await expectShell(page, "Patients");
  expect(requests.every(request => request.method === "GET")).toBe(true);
});
