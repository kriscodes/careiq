import { expect, test } from "@playwright/test";

/** Read-only checks against the actual Next/Clerk development app, never a provider mutation. */
test.beforeEach(async ({ context }) => {
  await context.route("**/*", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.abort("blockedbyclient");
    await route.continue();
  });
});
test("actual Clerk custom sign-in renders, supports password managers, and clamps return routes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.name));
  const response = await page.goto("/sign-in?returnTo=https%3A%2F%2Fother.invalid%2F");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
  const email = page.getByLabel("Email Address", { exact: true });
  await expect(email).toHaveAttribute("autocomplete", "username");
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("autocomplete", "current-password");
  await password.fill("synthetic-local-value-not-submitted");
  await page.getByRole("button", { name: "Show Password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("synthetic-local-value-not-submitted");
  await page.getByRole("button", { name: "Hide Password", exact: true }).click();
  await expect(password).toHaveAttribute("type", "password");
  await expect(page.getByRole("link", { name: "Create An Account" })).toHaveAttribute("href", "/sign-up?returnTo=%2F");
  expect(errors).toEqual([]);
});
test("actual sign-up, recovery, help dialog, and mobile viewport stay usable without writing an account", async ({ page }) => {
  await page.goto("/sign-up?returnTo=%2Fjoin");
  await expect(page.getByRole("heading", { name: "A little hello." })).toBeVisible();
  await expect(page.getByLabel("Work Email", { exact: true })).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await expect(page.getByRole("link", { name: "Sign In", exact: true })).toHaveAttribute("href", "/sign-in?returnTo=%2Fjoin");
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  const help = page.getByRole("button", { name: "Need A Hand?" });
  await help.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(help).toBeFocused();
  await page.goto("/sign-in?returnTo=%2Fjoin");
  await page.getByRole("button", { name: "Forgot Password?" }).click();
  await expect(page.getByRole("heading", { name: "Let’s get you back in." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send Reset Code" })).toBeVisible();
});
test("the actual browser invitation fallback preserves a safe join intent for signed-out users", async ({ page }) => {
  expect((await page.goto("/join"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Good to see you." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create An Account" })).toHaveAttribute("href", "/sign-up?returnTo=%2Fjoin");
});
