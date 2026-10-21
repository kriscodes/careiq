import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page, Route } from "@playwright/test";
import { test, expect } from "./harness";

const calls = (page: Page) => page.evaluate(() => window.__careiqMockCalls || []);
const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
const captureDirectory = resolve(__dirname, "../../../../docs/verification/little-hello-2026-10-21");
async function capture(page: Page, name: string) {
  if (process.env.CAREIQ_CAPTURE_LITTLE_HELLO !== "1") return;
  await mkdir(captureDirectory, { recursive: true });
  await page.screenshot({ path: resolve(captureDirectory, name + ".png"), fullPage: true });
}
async function expectWhite(page: Page) {
  expect(await page.evaluate(() => [document.documentElement, document.body, document.querySelector(".cq-access")!, ...document.querySelectorAll(".cq-a-input")].every(element => {
    const scheme = getComputedStyle(element).colorScheme;
    return scheme.includes("light") && !scheme.includes("dark");
  }))).toBe(true);
  for (const input of await page.locator(".cq-a-input").all()) await expect(input).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".cq-access")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", async route => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname)) return route.abort("blockedbyclient");
    await route.continue();
  });
});

test("Little hello remains white under dark system settings on desktop and 320px screens", async ({ page, harnessUrl }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 812 : 900 });
    await page.goto(`${harnessUrl}/?component=auth&providers=google`);
    await expect(page.getByRole("heading", { name: "Good to see you.", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expectWhite(page);
    await capture(page, `signin-dark-system-${width}`);
    await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Let’s get you back in.", exact: true })).toBeVisible();
    await expectWhite(page);
    await capture(page, `forgot-dark-system-${width}`);
    await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
    await page.getByRole("button", { name: /Send reset code/ }).click();
    await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
    await expectWhite(page);
    await capture(page, `reset-code-dark-system-${width}`);
    await page.goto(`${harnessUrl}/?component=auth&mode=signup&providers=google`);
    await expect(page.getByRole("heading", { name: "A little hello.", exact: true })).toBeVisible();
    await expectWhite(page);
    await capture(page, `signup-dark-system-${width}`);
  }
});

test("local fonts and character assets are actual files and missing brand requests return 404", async ({ page, harnessUrl, request }) => {
  const external: string[] = [], failures: string[] = [];
  page.on("request", event => { if (!event.url().startsWith(harnessUrl)) external.push(event.url()); });
  page.on("pageerror", error => failures.push(error.message));
  await page.goto(`${harnessUrl}/?component=auth&providers=google,microsoft,apple`);
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].filter(font => ["Caprasimo", "Nunito Sans"].includes(font.family.replaceAll('"', ""))).map(font => ({ family: font.family.replaceAll('"', ""), status: font.status })))).toEqual(expect.arrayContaining([{ family: "Caprasimo", status: "loaded" }, { family: "Nunito Sans", status: "loaded" }]));
  const font = await request.get(`${harnessUrl}/brand/fonts/caprasimo.woff2`);
  expect(font.status()).toBe(200); expect(font.headers()["content-type"]).toBe("font/woff2"); expect((await font.body()).subarray(0, 4).toString()).toBe("wOF2");
  const character = await request.get(`${harnessUrl}/brand/little-hello/little-hello-companion.png`);
  expect(character.status()).toBe(200); expect(character.headers()["content-type"]).toBe("image/png"); expect((await character.body()).subarray(1, 4).toString()).toBe("PNG");
  for (const path of ["/brand/fonts/missing.woff2", "/brand/%2f..%2fpackage.json"]) {
    const missing = await request.get(harnessUrl + path);
    expect(missing.status()).toBe(404); expect(missing.headers()["content-type"]).toContain("text/plain"); expect(await missing.text()).not.toContain("<!doctype");
  }
  expect(external).toEqual([]); expect(failures).toEqual([]);
});

test("keyboard recovery moves focus to each step and keeps the help dialog reversible", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth`);
  await expect(page.getByRole("heading", { name: "Good to see you.", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address", { exact: true })).toBeFocused();
  await page.keyboard.type("synthetic@example.invalid");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Forgot password?", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Let’s get you back in.", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address", { exact: true })).toBeFocused();
  await page.keyboard.type("synthetic@example.invalid");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Send reset code/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Check your email", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Need a hand?", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Need a hand?", exact: true })).toBeFocused();
});

test("provider choices use only the configured allowlist and preserve a safe callback", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&providers=unknown,passkey,sso`);
  await expect(page.locator(".cq-a-social")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Other ways to sign in", exact: true })).toBeVisible();
  for (const mode of ["signin", "signup"] as const) {
    await page.goto(`${harnessUrl}/?component=auth&mode=${mode}&providers=google,microsoft,apple,google,unknown&returnTo=%2Fpatient-paperwork`);
    await expect(page.locator(".cq-a-social")).toHaveCount(3);
    for (const provider of ["Google", "Microsoft", "Apple"]) {
      await page.getByRole("button", { name: `Continue with ${provider}`, exact: true }).click();
      await expect.poll(async () => (await calls(page)).filter(call => call.name === "providerSSO").length).toBeGreaterThan(0);
      expect((await calls(page)).filter(call => call.name === "providerSSO").at(-1)?.input).toEqual({ source: mode, strategy: `oauth_${provider.toLowerCase()}`, redirectUrl: "/session-tasks?returnTo=%2Fpatient-paperwork", redirectCallbackUrl: `/sign-${mode === "signup" ? "up" : "in"}?returnTo=%2Fpatient-paperwork#/sso-callback` });
    }
    expect((await calls(page)).filter(call => ["password", "createAccount", "signInFinalize", "signUpFinalize"].includes(call.name))).toHaveLength(0);
    expect(await page.evaluate(() => sessionStorage.getItem("careiq.account-return"))).toBe("/patient-paperwork");
  }
  await page.goto(`${harnessUrl}/?component=auth&providers=google&returnTo=https%3A%2F%2Foutside.invalid`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  expect((await calls(page)).find(call => call.name === "providerSSO")?.input).toMatchObject({ redirectUrl: "/session-tasks?returnTo=%2F", redirectCallbackUrl: "/sign-in?returnTo=%2F#/sso-callback" });
});

test("provider errors stay private and pending redirects cannot submit credentials twice", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=auth-provider-error&providers=google`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Please try again");
  await expect(page.getByRole("alert")).not.toContainText("private provider secret");
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await page.goto(`${harnessUrl}/?component=auth&scenario=auth-provider-pending&providers=google`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Email address", { exact: true })).toBeDisabled();
  expect((await calls(page)).filter(call => call.name === "providerSSO")).toHaveLength(1);
  expect((await calls(page)).filter(call => call.name === "password")).toHaveLength(0);
  await page.evaluate(() => window.__careiqAuthFetch!.resolveProvider());
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
});

test("invitation continuation stays provider owned even with configured social shortcuts", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=auth&scenario=signed-invite&providers=google,microsoft,apple&__clerk_ticket=synthetic-invitation-ticket`);
  await expect(page.locator(".cq-a-social")).toHaveCount(0);
  await page.getByRole("button", { name: "Use the invited account", exact: true }).click();
  expect((await calls(page)).find(call => call.name === "signOut")?.input).toEqual({ redirectUrl: `${harnessUrl}/?__clerk_ticket=synthetic-invitation-ticket` });
});

for (const role of ["owner", "administrator", "member", "configured-clinician"] as const) {
  test(`${role} pending enrollment never grants clinical reads after identity is known`, async ({ page, harnessUrl }) => {
    const paths: string[] = [];
    await page.route("**/api/v1/**", async route => {
      paths.push(new URL(route.request().url()).pathname);
      await json(route, { data: { userId: "user_test", orgId: "org_test", practice: { id: "practice_test", name: "Synthetic practice", authorizationMode: "location", status: "active" }, onboarding: "pending", enrollmentStatus: "pending_assignment", capabilities: { patients: { read: false, create: false }, appointments: { read: false, create: false } }, management: { locations: false, members: false }, locations: [] } });
    });
    await page.goto(`${harnessUrl}/?component=workspace&identityRole=${role}`);
    await expect(page.getByRole("heading", { name: "You’ve joined the team", exact: true })).toBeVisible();
    expect(paths).toEqual(["/api/v1/me"]);
    await expect(page.getByRole("button", { name: "Patients", exact: true })).toHaveCount(0);
  });
}

test("a signed-in patient without a portal grant sees no paperwork or staff workspace", async ({ page, harnessUrl }) => {
  const requests: { method: string; path: string }[] = [];
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push({ method: route.request().method(), path });
    return json(route, { data: path.endsWith("communication-preferences") ? { profiles: [] } : { items: [], hasMore: false, nextCursor: null } });
  });
  await page.goto(`${harnessUrl}/?component=patient-paperwork`);
  await expect(page.getByText("The practice must confirm your access before these choices are available.", { exact: true })).toBeVisible();
  await expect(page.locator(".wf-paperwork-list article")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Patients", exact: true })).toHaveCount(0);
  expect(requests.every(request => request.method === "GET" && request.path.startsWith("/api/v1/patient-paperwork"))).toBe(true);
});

async function submitTrustPassword(page: Page, harnessUrl: string, scenario: string) {
  await page.goto(`${harnessUrl}/?component=auth&scenario=${scenario}`);
  await page.getByLabel("Email address", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("new-device trust requires an explicit send and a valid code before finalization", async ({ page, harnessUrl }) => {
  await submitTrustPassword(page, harnessUrl, "auth-trust");
  await expect(page.getByRole("heading", { name: "Verify this sign-in", exact: true })).toBeFocused();
  await expect(page.locator(".cq-a-lead")).toContainText("Send a code to your verified email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Provider completion fixture", { exact: true })).toHaveCount(0);
  expect((await calls(page)).filter(call => ["sendMFAEmailCode", "signInFinalize"].includes(call.name))).toHaveLength(0);
  await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  await expect(page.getByRole("heading", { name: "One more step", exact: true })).toBeFocused();
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveAttribute("autocomplete", "one-time-code");
  expect((await calls(page)).filter(call => call.name === "sendMFAEmailCode")).toHaveLength(1);
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  expect((await calls(page)).filter(call => call.name === "signInFinalize")).toHaveLength(0);
  await page.getByLabel("Verification code", { exact: true }).fill("111111");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "signInFinalize").length).toBe(1);
  expect((await calls(page)).filter(call => call.name === "password")).toHaveLength(1);
});

for (const prepared of [false, true]) {
  test(`restored device trust ${prepared ? "keeps its prepared challenge" : "asks before sending"} without requesting another code`, async ({ page, harnessUrl }) => {
    const scenario = prepared ? "auth-trust-restored-prepared" : "auth-trust-restored";
    await page.goto(`${harnessUrl}/?component=auth&scenario=${scenario}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await page.reload();
      await expect(page.getByRole("heading", { name: prepared ? "One more step" : "Verify this sign-in", exact: true })).toBeVisible();
      await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Provider completion fixture", { exact: true })).toHaveCount(0);
      if (prepared) {
        await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
        await expect(page.locator(".cq-a-lead")).toContainText("code sent to your email");
      } else {
        await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Send verification code", exact: true })).toBeEnabled();
      }
      expect((await calls(page)).filter(call => ["sendMFAEmailCode", "sendMFAPhoneCode", "password", "signInFinalize"].includes(call.name))).toHaveLength(0);
    }
    if (!prepared) {
      await page.setViewportSize({ width: 320, height: 812 });
      await page.emulateMedia({ colorScheme: "dark" });
      await expectWhite(page);
      await capture(page, "trust-unsent-dark-system-320");
    }
  });
}

test("a failed device-trust send stays unsent and retries without repeating the password", async ({ page, harnessUrl }) => {
  await submitTrustPassword(page, harnessUrl, "auth-trust-send-error");
  const send = page.getByRole("button", { name: "Send verification code", exact: true });
  await send.click();
  await expect(page.getByRole("alert")).toContainText("Please try again");
  await expect(page.getByRole("alert")).not.toContainText("private provider secret");
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
  expect((await calls(page)).filter(call => call.name === "sendMFAEmailCode")).toHaveLength(2);
  expect((await calls(page)).filter(call => call.name === "password")).toHaveLength(1);
  expect((await calls(page)).filter(call => call.name === "signInFinalize")).toHaveLength(0);
});

test("the observed trust-code rate limit shows localized wait copy and never claims a code was sent", async ({ page, harnessUrl }) => {
  await submitTrustPassword(page, harnessUrl, "auth-trust-rate-limit");
  await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Too many attempts. Wait a little before trying again.");
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
  await expect(page.locator(".cq-a-lead")).toContainText("Send a code");
  await page.getByLabel("Interface language", { exact: true }).selectOption("es");
  await expect(page.getByRole("alert")).toHaveText("Demasiados intentos. Espera un poco antes de volver a intentarlo.");
  await expect(page.getByRole("button", { name: "Enviar código de verificación", exact: true })).toBeEnabled();
  await expect(page.getByRole("alert")).not.toContainText(/private|429|seconds|\d/);
  expect((await calls(page)).filter(call => call.name === "sendMFAEmailCode")).toHaveLength(1);
  expect((await calls(page)).filter(call => call.name === "signInFinalize")).toHaveLength(0);
});

test("unsupported device-trust factors remain provider owned and OAuth callbacks retain precedence", async ({ page, harnessUrl }) => {
  await submitTrustPassword(page, harnessUrl, "auth-trust-unsupported");
  await expect(page.getByText("Provider completion fixture", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send verification code", exact: true })).toHaveCount(0);
  expect((await calls(page)).filter(call => ["sendMFAEmailCode", "signInFinalize"].includes(call.name))).toHaveLength(0);
  await page.goto(`${harnessUrl}/?component=auth&scenario=auth-trust-restored-prepared#/sso-callback`);
  await expect(page.getByText("Provider completion fixture", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
  expect((await calls(page)).filter(call => ["sendMFAEmailCode", "signInFinalize"].includes(call.name))).toHaveLength(0);
});

test("supported phone device trust verifies the actual phone factor before finalizing", async ({ page, harnessUrl }) => {
  await submitTrustPassword(page, harnessUrl, "auth-trust-phone");
  await expect(page.locator(".cq-a-lead")).toContainText("verified phone");
  await page.getByRole("button", { name: "Send verification code", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("111111");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  expect((await calls(page)).filter(call => call.name === "sendMFAPhoneCode")).toHaveLength(1);
  expect((await calls(page)).filter(call => call.name === "verifyMFAPhoneCode")).toHaveLength(1);
  expect((await calls(page)).filter(call => call.name === "sendMFAEmailCode")).toHaveLength(0);
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "signInFinalize").length).toBe(1);
});

test("a backup-only supported challenge uses the recovery-code path", async ({ page, harnessUrl }) => {
  await submitTrustPassword(page, harnessUrl, "auth-trust-backup");
  await expect(page.getByLabel("Recovery code", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Recovery code", { exact: true })).toHaveAttribute("autocomplete", "off");
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
  await page.getByLabel("Recovery code", { exact: true }).fill("synthetic-recovery-code");
  await page.getByRole("button", { name: /Verify & continue/ }).click();
  expect((await calls(page)).filter(call => call.name === "verifyBackupCode")).toHaveLength(1);
  expect((await calls(page)).filter(call => call.name === "verifyMFAEmailCode")).toHaveLength(0);
  await expect.poll(async () => (await calls(page)).filter(call => call.name === "signInFinalize").length).toBe(1);
});

test("back from a recovery code restores a supported factor without sending a code", async ({ page, harnessUrl }) => {
  await submitTrustPassword(page, harnessUrl, "auth-trust-backup");
  await page.getByRole("button", { name: "← Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Good to see you.", exact: true })).toBeVisible();
  await expect(page.getByLabel("Verification code", { exact: true })).toHaveCount(0);
  expect((await calls(page)).filter(call => ["sendMFAEmailCode", "verifyMFAEmailCode", "signInFinalize"].includes(call.name))).toHaveLength(0);
  await submitTrustPassword(page, harnessUrl, "mfa");
  await page.getByRole("button", { name: "Use a recovery code", exact: true }).click();
  await page.getByRole("button", { name: "← Back to verification", exact: true }).click();
  await expect(page.getByLabel("Verification code", { exact: true })).toBeVisible();
  await expect(page.locator(".cq-a-lead")).toContainText("authenticator app");
  expect((await calls(page)).filter(call => ["sendMFAEmailCode", "sendMFAPhoneCode", "signInFinalize"].includes(call.name))).toHaveLength(0);
});
