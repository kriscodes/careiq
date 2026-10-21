import { resolve } from "node:path";
import type { Page, Route } from "@playwright/test";
import { test, expect } from "./harness";
import type { AccessContext } from "../../src/lib/api/practice";
import type { OnboardingState, PracticeDraft } from "../../src/lib/access-flow";
const location = { id: "11111111-1111-4111-8111-111111111111", name: "Main location", timeZone: "America/Los_Angeles", status: "active" as const };
const access: AccessContext = { userId: "user_test", orgId: "org_test", practice: { id: "practice_test", name: "Test practice", authorizationMode: "location", status: "active" }, onboarding: "ready", enrollmentStatus: "active", capabilities: { patients: { read: true, create: false }, appointments: { read: true, create: false } }, management: { locations: false, members: false }, locations: [] };
const frozen: PracticeDraft = { practiceName: "Test practice", locationName: "Main location", timeZone: "America/Los_Angeles", address: "", step: 3 };
const state: OnboardingState = { eligible: true, emailVerified: true, draft: null, operation: null };
const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
const calls = (page: Page) => page.evaluate(() => window.__careiqMockCalls || []);
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async route => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

test("custom sign-in reports a safe failure and leaves the form retryable", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=signin-error`);
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("The email or password is incorrect. Try again.");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  expect((await calls(page)).filter(call => call.name === "signInFinalize")).toHaveLength(0);
});
for (const mode of ["signin", "signup"] as const) {
  const provider = mode === "signup" ? "Provider signup fixture" : "Provider completion fixture";
  const email = mode === "signup" ? "Work email" : "Email address";
  test(`${mode} cold OAuth callback delegates to Clerk before and after reload`, async ({ page, harnessUrl }) => {
    const callbackUrl = `${harnessUrl}/sign-${mode === "signup" ? "up" : "in"}?component=auth&mode=${mode}&returnTo=%2Fpatient-paperwork#/sso-callback?__clerk_status=verified`;
    await page.goto(callbackUrl);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await page.reload();
      await expect(page.getByText(provider, { exact: true })).toBeVisible();
      await expect(page.getByLabel(email, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
      expect(page.url()).toBe(callbackUrl);
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("careiq.account-return"))).toBe("/patient-paperwork");
      expect((await calls(page)).filter(call => ["password", "createAccount", "signInFinalize", "signUpFinalize"].includes(call.name))).toHaveLength(0);
    }
  });
  test(`${mode} keeps credentials for normal entry and unrelated hashes`, async ({ page, harnessUrl }) => {
    await page.goto(`${harnessUrl}/?component=auth&mode=${mode}`);
    await expect(page.getByLabel(email, { exact: true })).toBeVisible();
    for (const hash of ["#/other", "#/sso-callback-extra", "#/sso-callback/other", "#/sso-callback#other"]) {
      await page.evaluate(value => { window.location.hash = value; }, hash);
      await page.reload();
      await expect(page.getByLabel(email, { exact: true })).toBeVisible();
      await expect(page.getByText(provider, { exact: true })).toHaveCount(0);
    }
  });
}

test("OAuth callback takes precedence over restored signup email verification", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/sign-up?component=auth&mode=signup&scenario=auth-restored-signup#/sso-callback`);
  await expect(page.getByText("Provider signup fixture", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
  expect((await calls(page)).filter(call => ["sendVerificationCode", "verifyEmail", "signUpFinalize"].includes(call.name))).toHaveLength(0);
});

test("provider hash changes keep Clerk mounted after deliberate social sign-in entry", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth`);
  await page.getByRole("button", { name: "Other sign-in options", exact: true }).click();
  await expect(page.getByText("Provider completion fixture", { exact: true })).toBeVisible();
  for (const hash of ["/sso-callback?__clerk_status=verified", "/continue"]) {
    await page.evaluate(value => { window.location.hash = value; }, hash);
    await expect(page.getByText("Provider completion fixture", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  }
  expect((await calls(page)).filter(call => ["password", "signInFinalize"].includes(call.name))).toHaveLength(0);
});

test("MFA failure cannot finalize; a deliberate recovery code can", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=mfa`);
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "One more step" })).toBeVisible();
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  expect((await calls(page)).filter(call => call.name === "signInFinalize")).toHaveLength(0);
  await page.getByRole("button", { name: "Use a recovery code", exact: true }).click();
  await page.getByLabel("Recovery code", { exact: true }).fill("synthetic-backup-code");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "signInFinalize").length).toBe(1);
});
test("password recovery is generic for unknown accounts and reports service outages", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=unknown-account`);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address", { exact: true }).fill("unknown@example.invalid");
  await page.getByRole("button", { name: /Send reset code/ }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.locator(".cq-a-lead")).toContainText("If an account exists");
  expect((await calls(page)).filter(call => call.name === "sendResetCode")).toHaveLength(0);
  await page.goto(`${harnessUrl}/?component=auth&scenario=recovery-offline`);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
  await page.getByRole("button", { name: /Send reset code/ }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Please try again");
  await expect(page.getByRole("alert")).not.toContainText("secret");
});
test("password reset checks confirmation and signs out other sessions only after a valid code", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth`);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
  await page.getByRole("button", { name: /Send reset code/ }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("111111");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  await page.getByLabel("New password", { exact: true }).fill("new-synthetic-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("different-synthetic-password");
  await page.getByRole("button", { name: /Update password/ }).click();
  await expect(page.getByRole("alert")).toContainText("don’t match");
  expect((await calls(page)).filter(call => call.name === "submitNewPassword")).toHaveLength(0);
  await page.getByLabel("Confirm password", { exact: true }).fill("new-synthetic-password");
  await page.getByRole("button", { name: /Update password/ }).click();
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
  expect((await calls(page)).find(call => call.name === "submitNewPassword")?.input).toEqual({ signOutOfOtherSessions: true });
});
test("signup verifies email before it can finalize", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&mode=signup`);
  await page.getByLabel("Full name (optional)").fill("Synthetic Owner");
  await page.getByLabel("Work email", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  expect((await calls(page)).filter(call => call.name === "signUpFinalize")).toHaveLength(0);
  await page.getByLabel("Verification code", { exact: true }).fill("111111");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "signUpFinalize").length).toBe(1);
});
test("failed session refresh is visible and retryable without exposing diagnostics", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=signed-expired`);
  await page.getByRole("button", { name: "Sign in again", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Please try again");
  await expect(page.getByRole("alert")).not.toContainText("secret");
  await page.getByRole("button", { name: "Sign in again", exact: true }).click();
  expect((await calls(page)).filter(call => call.name === "signOut")).toHaveLength(2);
});
test("switching from a signed-in invitation preserves its ticket until the provider handles it", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=signed-invite&__clerk_ticket=synthetic-invite-ticket`);
  await page.getByRole("button", { name: "Use the invited account" }).click();
  expect((await calls(page)).find(call => call.name === "signOut")?.input).toEqual({ redirectUrl: `${harnessUrl}/?__clerk_ticket=synthetic-invite-ticket` });
});
test("an active unmapped team explains setup instead of repeating the practice picker", async ({ page, harnessUrl }) => {
  const requests: { method: string; path: string }[] = [];
  await page.route("**/api/v1/**", async route => {
    requests.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
    await json(route, { data: { ...access, practice: null, onboarding: "required" } });
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await expect(page.getByRole("heading", { name: "Finish practice setup", exact: true })).toBeVisible();
  await expect(page.getByText("Your selected team does not have a CareIQ practice yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Test practice/ })).toHaveCount(0);
  await page.getByLabel("Interface language", { exact: true }).selectOption("es");
  await expect(page.getByRole("heading", { name: "Completa la configuración de la clínica", exact: true })).toBeVisible();
  await expect(page.getByText("El equipo seleccionado aún no tiene una clínica en CareIQ.", { exact: true })).toBeVisible();
  await page.getByLabel("Idioma de la interfaz", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Choose another practice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose your practice", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Test practice/ }).click();
  expect((await calls(page)).filter(call => call.name === "setActive")).toHaveLength(1);
  // Model the full return after activation: the server still has no practice mapping.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Finish practice setup", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View my invitations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Join your team", exact: true })).toBeVisible();
  expect(requests.every(request => request.method === "GET" && request.path === "/api/v1/me")).toBe(true);
});

for (const eligible of [false, true]) {
  test(`unmapped team setup uses the normal founder eligibility gate (${eligible ? "approved" : "unapproved"})`, async ({ page, harnessUrl }) => {
    const requests: { method: string; path: string }[] = [];
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      requests.push({ method: route.request().method(), path });
      await json(route, { data: path === "/api/v1/me" ? { ...access, practice: null, onboarding: "required" } : { ...state, eligible } });
    });
    await page.goto(`${harnessUrl}/?component=workspace`);
    await expect(page.getByRole("heading", { name: "Finish practice setup", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Set up a new practice", exact: true }).click();
    await expect(page.getByRole("heading", { name: eligible ? "What’s your practice called?" : "Practice setup needs approval", exact: true })).toBeVisible();
    await expect(page.getByLabel("Practice name", { exact: true })).toHaveCount(eligible ? 1 : 0);
    expect(requests).toEqual([{ method: "GET", path: "/api/v1/me" }, { method: "GET", path: "/api/v1/onboarding/state" }]);
    expect((await calls(page)).filter(call => call.name === "setActive")).toHaveLength(0);
  });
}

test("an account with no active organization keeps the normal practice chooser", async ({ page, harnessUrl }) => {
  const paths: string[] = [];
  await page.route("**/api/v1/**", async route => {
    paths.push(new URL(route.request().url()).pathname);
    await json(route, { data: { ...access, orgId: null, practice: null, onboarding: "required" } });
  });
  await page.goto(`${harnessUrl}/?component=workspace&scenario=no-active-organization`);
  await expect(page.getByRole("heading", { name: "Choose your practice", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish practice setup", exact: true })).toHaveCount(0);
  expect(paths).toEqual(["/api/v1/me"]);
});

test("saved setup restores its step and saves safely without provisioning", async ({ page, harnessUrl }) => {
  let draft: PracticeDraft = { ...frozen, step: 2 };
  let creations = 0;
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() === "POST") { creations++; return json(route, { data: {} }); }
    if (route.request().method() === "PUT") { draft = route.request().postDataJSON(); return json(route, { data: draft }); }
    return json(route, { data: { ...state, draft } });
  });
  await page.goto(`${harnessUrl}/?component=onboarding`);
  await expect(page.getByRole("heading", { name: "Add your first location" })).toBeVisible();
  await expect(page.getByLabel("Location name", { exact: true })).toHaveValue("Main location");
  await page.getByLabel("Location name", { exact: true }).fill("Updated location");
  await page.getByRole("button", { name: "Save & finish later" }).click();
  await expect(page.getByRole("heading", { name: "Your setup is saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Location name", { exact: true })).toHaveValue("Updated location");
  expect(creations).toBe(0);
});
test("an ineligible founder cannot see creation fields or issue a provisioning request", async ({ page, harnessUrl }) => {
  let writes = 0;
  await page.route("**/api/v1/**", async route => { if (route.request().method() !== "GET") writes++; await json(route, { data: { ...state, eligible: false } }); });
  await page.goto(`${harnessUrl}/?component=onboarding`);
  await expect(page.getByRole("heading", { name: "Practice setup needs approval" })).toBeVisible();
  await expect(page.getByLabel("Practice name", { exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});
test("setup requires authority confirmation and submits the minimal deliberate creation payload", async ({ page, harnessUrl }) => {
  const creates: { body: unknown; key: string | undefined }[] = [];
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() === "POST") { creates.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] }); return json(route, { data: { orgId: "org_created" } }); }
    if (route.request().method() === "PUT") return json(route, { data: route.request().postDataJSON() });
    return json(route, { data: state });
  });
  await page.goto(`${harnessUrl}/?component=onboarding`);
  await page.getByLabel("Practice name", { exact: true }).fill("  Test practice  ");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Location name", { exact: true }).fill("Main location");
  await page.getByLabel("Time zone", { exact: true }).selectOption("America/Los_Angeles");
  await page.getByRole("button", { name: /Review practice/ }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /Create practice and location/ }).click();
  expect(creates).toHaveLength(0);
  await page.getByRole("checkbox", { name: "I’m authorized to set up and manage this practice." }).check();
  await page.getByRole("button", { name: /Create practice and location/ }).click();
  await expect(page.getByRole("heading", { name: "Your practice is ready" })).toBeVisible();
  expect(creates).toHaveLength(1);
  expect(creates[0].body).toEqual({ name: "Test practice", location: { name: "Main location", timeZone: "America/Los_Angeles" } });
  expect(creates[0].key).toMatch(/^[0-9a-f-]{14}4[0-9a-f-]{21}$/i);
  await page.getByRole("button", { name: "Invite a teammate", exact: true }).click();
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "setActive").length).toBe(1);
  expect((await calls(page)).find(call => call.name === "setActive")?.input).toEqual({ organization: "org_created", hasNavigate: true });
});
test("pending setup freezes the payload and retries the same intent before and after reload", async ({ page, harnessUrl }) => {
  const attempts: { body: unknown; key: string | undefined }[] = [];
  let draftWrites = 0;
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() === "PUT") { draftWrites++; return json(route, {}, 409); }
    if (route.request().method() === "POST") { attempts.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] }); return attempts.length < 3 ? json(route, { error: { code: "PENDING", message: "private provider trace" } }, 500) : json(route, { data: { orgId: "org_created" } }); }
    return json(route, { data: { ...state, eligible: false, emailVerified: false, draft: frozen, operation: { state: "pending", practiceId: null, organizationId: null } } });
  });
  await page.goto(`${harnessUrl}/?component=onboarding`);
  await expect(page.getByRole("heading", { name: "Finishing your setup" })).toBeVisible();
  await page.getByRole("button", { name: "Check setup status" }).click();
  await expect(page.getByRole("alert")).toContainText("without changing the details");
  await expect(page.getByRole("alert")).not.toContainText("private");
  await page.getByRole("button", { name: "Check setup status" }).click();
  await expect.poll(() => attempts.length).toBe(2);
  await page.reload();
  await page.getByRole("button", { name: "Check setup status" }).click();
  await expect(page.getByRole("heading", { name: "Your practice is ready" })).toBeVisible();
  expect(attempts[0].body).toEqual(attempts[1].body);
  expect(attempts[1].body).toEqual(attempts[2].body);
  expect(attempts[0].key).toEqual(attempts[1].key);
  expect(attempts[2].key).not.toEqual(attempts[0].key);
  expect(draftWrites).toBe(0);
});
test("an uncertain invitation keeps its email, role, locations and attempt immutable", async ({ page, harnessUrl }) => {
  const invitations: { body: unknown; key: string | undefined }[] = [];
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() === "POST") { invitations.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] }); return invitations.length === 1 ? json(route, { error: { code: "PROVIDER_PENDING", message: "private provider trace" } }, 500) : json(route, { data: {} }); }
    return json(route, { data: { locations: [location], members: [], invitations: [], allowedRoles: ["org:member", "org:admin"] } });
  });
  await page.goto(`${harnessUrl}/?component=invite`);
  await page.getByLabel("Work email", { exact: true }).fill("teammate@example.invalid");
  await page.getByRole("checkbox", { name: /Main location/ }).check();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByLabel("Work email", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Role", { exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Main location/ })).toBeDisabled();
  await page.getByRole("button", { name: "Check invitation status" }).click();
  await expect(page.getByRole("heading", { name: "Invitation sent" })).toBeVisible();
  expect(invitations[0]).toEqual(invitations[1]);
});
test("owner clinical access starts unassigned and requires explicit location selection", async ({ page, harnessUrl }) => {
  const grants: unknown[] = [];
  await page.route("**/api/v1/**", async route => {
    if (route.request().method() === "POST") { grants.push(route.request().postDataJSON()); return json(route, { data: {} }); }
    return json(route, { data: { locations: [location], members: [{ userId: "user_test", isOwner: true, role: "org:admin", locationIds: [] }], invitations: [], allowedRoles: ["org:member", "org:admin"] } });
  });
  await page.goto(`${harnessUrl}/?component=owneraccess`);
  const choice = page.getByRole("checkbox", { name: /Main location/ });
  await expect(choice).not.toBeChecked();
  expect(grants).toHaveLength(0);
  await choice.check();
  await page.getByRole("button", { name: "Save my location access" }).click();
  await expect.poll(() => grants.length).toBe(1);
  expect(grants[0]).toEqual({ role: "org:admin", locationIds: [location.id] });
});
test("the wrong verified email cannot accept an invitation or open records", async ({ page, harnessUrl }) => {
  const clinical: string[] = [];
  await page.route("**/api/v1/**", async route => { const path = new URL(route.request().url()).pathname; if (path !== "/api/v1/me") clinical.push(path); await json(route, { data: access }); });
  await page.goto(`${harnessUrl}/?component=workspace&scenario=wrong-invite-email&view=invitations`);
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("alert")).toContainText("Use your invited email");
  expect((await calls(page)).filter(call => call.name === "acceptInvitation")).toHaveLength(0);
  expect(clinical).toHaveLength(0);
});
test("pending membership never dispatches clinical reads even if a role is visible", async ({ page, harnessUrl }) => {
  const paths: string[] = [];
  await page.route("**/api/v1/**", async route => { paths.push(new URL(route.request().url()).pathname); await json(route, { data: { ...access, onboarding: "pending", enrollmentStatus: "pending_assignment" } }); });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await expect(page.getByRole("heading", { name: "You’ve joined the team" })).toBeVisible();
  expect(paths).toEqual(["/api/v1/me"]);
});
test("in-progress nonclinical setup survives an inbox switch", async ({ page, harnessUrl }) => {
  await page.route("**/api/v1/**", async route => { await json(route, { data: new URL(route.request().url()).pathname === "/api/v1/me" ? { ...access, practice: null, onboarding: "required" } : state }); });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await page.getByRole("button", { name: "Set up a new practice" }).click();
  await page.getByLabel("Practice name", { exact: true }).fill("Unsubmitted practice draft");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Practice name", { exact: true })).toHaveValue("Unsubmitted practice draft");
});
test("fresh token resource updates do not restart or starve the first workflow request", async ({ page, harnessUrl }) => {
  const paths: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    if (path === "/api/v1/me") return json(route, { data: { ...access, locations: [location] } });
    if (path === `/api/v1/locations/${location.id}/workflow`) return json(route, { data: { location, timeZone: "UTC", patients: [{ id: "patient_test", firstName: "Synthetic", lastName: "Refresh", email: null, phone: null }], appointments: [], documents: [], templates: [], requests: [], workItems: [], providers: [], visitTypes: [], documentTypes: [], capabilities: { patientsRead: true, appointmentsRead: true }, asOf: "2026-10-16T12:00:00Z" } });
    return json(route, { error: { code: "UNEXPECTED_REQUEST" } }, 500);
  });
  await page.goto(`${harnessUrl}/?component=workspace&scenario=workflow-token-refresh`);
  await expect(page.getByRole("heading", { name: "Where are you working?", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).evaluate(button => (button as HTMLButtonElement).click());
  const workflowPath = `/api/v1/locations/${location.id}/workflow`;
  await expect.poll(() => paths.filter(path => path === workflowPath).length, { timeout: 3000 }).toBeGreaterThan(0);
  await expect(page.getByText("Opening your front desk…", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await expect(page.getByRole("button", { name: /Synthetic Refresh/ })).toBeVisible();
  const completedRequests = paths.length;
  const completedTokens = (await calls(page)).filter(call => call.name === "getToken");
  expect(completedTokens.length).toBeLessThanOrEqual(4);
  expect(completedTokens.every(call => (call.input as { organizationId?: string; skipCache?: boolean }).organizationId === "org_test" && (call.input as { skipCache?: boolean }).skipCache === true)).toBe(true);
  await page.evaluate(async () => {
    window.__careiqAuthFetch!.set("signin", "fetching");
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  expect(paths).toHaveLength(completedRequests);
  expect((await calls(page)).filter(call => call.name === "getToken")).toHaveLength(completedTokens.length);
  await expect(page.getByRole("button", { name: /Synthetic Refresh/ })).toBeVisible();
});

test("an opened clinical scope is discarded on backgrounding and revocation blocks reopening", async ({ page, harnessUrl }) => {
  let revoked = false;
  const clinicalPaths: string[] = [];
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/me") return json(route, { data: { ...access, locations: [location], enrollmentStatus: revoked ? "revoked" : "active" } });
    clinicalPaths.push(path);
    if (path.endsWith("/workflow")) return json(route, { data: { location, timeZone: location.timeZone, patients: [{ id: "patient_test", firstName: "Synthetic", lastName: "Browser", email: null, phone: null }], appointments: [], documents: [], templates: [], requests: [], workItems: [], providers: [], visitTypes: [], documentTypes: [], capabilities: { patientsRead: true, appointmentsRead: true }, asOf: "2026-10-16T12:00:00Z" } });
    return json(route, { data: path.endsWith("/patients") ? [{ id: "patient_test", firstName: "Synthetic", lastName: "Browser", email: null, phone: null }] : [] });
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await expect(page.getByRole("heading", { name: "Where are you working?" })).toBeVisible();
  expect(clinicalPaths).toHaveLength(0);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /^Patients/ }).click();
  await expect(page.getByRole("button", { name: /Synthetic Browser/ })).toBeVisible();
  expect(clinicalPaths.every(path => path.startsWith(`/api/v1/locations/${location.id}/`))).toBe(true);
  const reads = clinicalPaths.length;
  revoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("heading", { name: "Your workspace is paused" })).toBeVisible();
  await expect(page.getByText("Synthetic Browser", { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Your access has changed" })).toBeVisible();
  expect(clinicalPaths).toHaveLength(reads);
});

test("onboarding and owner management redact provider token failures and remain retryable", async ({ page, harnessUrl }) => {
  for (const component of ["onboarding", "invite"]) {
    await page.goto(`${harnessUrl}/?component=${component}&scenario=token-error`);
    await expect(page.getByRole("alert")).toContainText("Please try again");
    await expect(page.getByRole("alert")).not.toContainText("private provider");
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
  }
});

test("real Clerk preloaded auth state cannot make an unloaded sign-in proxy actionable", async ({ page }) => {
  test.setTimeout(60000);
  const { authRuntimeHarness } = await import("./auth-runtime-harness"); const isolated = await authRuntimeHarness();
  try {
    let navigations = 0;
    page.on("request", request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++; });
    await page.goto(isolated.url);
    await expect(page.getByTestId("server-auth-state")).toHaveText("loaded");
    await expect(page.getByRole("heading", { name: "Opening CareIQ…" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.getByRole("alert")).toContainText("sign-in service", { timeout: 15_000 });
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeEnabled();
    await retry.hover();
    const stable = await retry.evaluate(async button => {
      const samples: { disabled: boolean; cursor: string }[] = [];
      for (let count = 0; count < 90; count++) { await new Promise(requestAnimationFrame); samples.push({ disabled: button.matches(":disabled"), cursor: getComputedStyle(button).cursor }); }
      return samples;
    });
    expect(stable.every(sample => !sample.disabled && sample.cursor === "pointer")).toBe(true);
    expect(navigations).toBe(1);
    if (process.env.CAREIQ_CAPTURE_AUTH === "1") {
      const output = resolve(__dirname, "../../../../docs/verification/security-load-2026-10-17");
      await page.screenshot({ path: resolve(output, "auth-sdk-unavailable-desktop.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: resolve(output, "auth-sdk-unavailable-mobile.png"), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await expect(page.locator("input")).toHaveCount(0);
    await retry.click();
    await expect.poll(() => navigations).toBe(2);
    await expect(page.getByRole("heading", { name: "Opening CareIQ…" })).toBeVisible();
    await expect(page.locator("input")).toHaveCount(0);
  } finally { await isolated.close(); }
});

test("stationary sign-in hover remains enabled through passive provider fetch transitions", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=auth-noise`);
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.hover();
  const samples = await submit.evaluate(async button => {
    const states: { disabled: boolean; cursor: string; hovered: boolean }[] = [];
    for (let count = 0; count < 90; count++) {
      window.__careiqAuthFetch!.set(count % 2 ? "signin" : "signup", count % 4 < 2 ? "fetching" : "idle");
      await new Promise(requestAnimationFrame);
      states.push({ disabled: button.matches(":disabled"), cursor: getComputedStyle(button).cursor, hovered: button.matches(":hover") });
    }
    return states;
  });
  expect(samples.every(sample => !sample.disabled && sample.cursor === "pointer" && sample.hovered)).toBe(true);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("synthetic-password");
  expect((await calls(page)).filter(call => call.name === "password")).toHaveLength(0);
  await submit.click();
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "signInFinalize").length).toBe(1);
});

test("a deliberate pending sign-in locks once and prevents duplicate submissions", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=auth-deferred`);
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole("button", { name: "One moment", exact: false })).toBeDisabled();
  expect((await calls(page)).filter(call => call.name === "password")).toHaveLength(1);
  expect((await calls(page)).filter(call => call.name === "signInFinalize")).toHaveLength(0);
  await page.evaluate(() => window.__careiqAuthFetch!.resolvePassword());
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "signInFinalize").length).toBe(1);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("a restored pending MFA attempt is preserved and never silently finalized", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=auth-restored-mfa`);
  await expect(page.getByText("Provider completion fixture", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.__careiqAuthFetch!.set("signup", "fetching"); window.__careiqAuthFetch!.set("signin", "idle"); });
  await expect(page.getByText("Provider completion fixture", { exact: true })).toBeVisible();
  expect((await calls(page)).filter(call => ["password", "signInFinalize"].includes(call.name))).toHaveLength(0);
});

test("SDK failure is retryable without mounting credentials in English and Spanish", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=auth-failed`);
  await expect(page.getByRole("alert")).toContainText("sign-in service");
  await expect(page.locator("input")).toHaveCount(0);
  await page.getByLabel("Interface language", { exact: true }).selectOption("es");
  await expect(page.getByRole("alert")).toContainText("servicio de inicio de sesión");
  await expect(page.getByRole("button", { name: "Intentar de nuevo", exact: true })).toBeEnabled();
  await expect(page.locator("input")).toHaveCount(0);
});
