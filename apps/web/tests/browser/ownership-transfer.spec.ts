import { test, expect } from "./harness";
const recipientA = "Alex (user_AdminA@example.invalid)";
const recipientB = "Blair (user_AdminB@example.invalid)";
const phrase = "Type Synthetic Practice to confirm";
const submissions = (page: import("@playwright/test").Page) => page.evaluate(() => (window.__careiqMockCalls || []).filter(call => call.name === "transferOwnership"));
test.beforeEach(async ({ page }) => { await page.route("**/*", async route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()); });

test("ownership requires exact typed practice name and an explicit named eligible recipient", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=ownership`);
  const select = page.getByRole("combobox", { name: "New owner", exact: true });
  await expect(select.locator("option")).toHaveText(["Select an active administrator", recipientA, recipientB]);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Transfer ownership to/ })).toHaveCount(0);
  await select.selectOption("user_AdminA");
  const button = page.getByRole("button", { name: `Transfer ownership to ${recipientA}`, exact: true });
  await expect(page.getByText("You’re transferring Synthetic Practice to " + recipientA + ". The new owner gets full workspace access. Your access will follow your staff permissions and location assignments. You’ll lose owner controls and can’t undo this yourself.", { exact: true })).toBeVisible();
  for (const value of ["synthetic practice", " Synthetic Practice", "Synthetic Practice ", "Synthetic"]) { await page.getByLabel(phrase, { exact: true }).fill(value); await expect(button).toBeDisabled(); }
  await page.getByLabel(phrase, { exact: true }).fill("Synthetic Practice");
  await expect(button).toBeEnabled(); await button.click();
  await expect.poll(() => submissions(page)).toEqual([{ name: "transferOwnership", input: { userId: "user_AdminA", practiceId: "11111111-1111-4111-8111-111111111111", confirmationName: "Synthetic Practice", acknowledgedUserId: "user_AdminA" } }]);
  await expect(select).toHaveValue("");
});

test("changing recipient or current practice clears typed confirmation before another transfer", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=ownership`);
  const select = page.getByRole("combobox", { name: "New owner", exact: true });
  await select.selectOption("user_AdminA"); await page.getByLabel(phrase, { exact: true }).fill("Synthetic Practice");
  await select.selectOption("user_AdminB"); await expect(page.getByLabel(phrase, { exact: true })).toHaveValue("");
  await page.getByLabel(phrase, { exact: true }).fill("Synthetic Practice"); await page.getByRole("button", { name: "Switch fixture practice", exact: true }).click();
  await expect(select).toHaveValue(""); await expect(page.getByLabel(phrase, { exact: true })).toHaveCount(0);
  await select.selectOption("user_AdminA"); await page.getByLabel(phrase, { exact: true }).fill("Synthetic Practice");
  await page.getByRole("button", { name: "Rename fixture practice", exact: true }).click(); await expect(select).toHaveValue("");
  await select.selectOption("user_AdminA"); await expect(page.getByLabel("Type Renamed Practice to confirm", { exact: true })).toHaveValue("");
  await page.getByLabel("Type Renamed Practice to confirm", { exact: true }).fill("Renamed Practice");
  await page.getByRole("button", { name: "Change fixture eligibility", exact: true }).click(); await expect(select).toHaveValue("");
  await expect(select.locator("option")).toHaveText(["Select an active administrator", recipientB]);
  expect(await submissions(page)).toHaveLength(0);
});

test("pending ownership transfer locks form and cannot be submitted twice", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=ownership&scenario=ownership-pending`);
  await page.getByRole("combobox", { name: "New owner", exact: true }).selectOption("user_AdminA"); await page.getByLabel(phrase, { exact: true }).fill("Synthetic Practice");
  await page.getByRole("button", { name: `Transfer ownership to ${recipientA}`, exact: true }).dblclick();
  await expect(page.getByRole("button", { name: "Transferring ownership…", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "New owner", exact: true })).toBeDisabled(); await expect(page.getByLabel(phrase, { exact: true })).toBeDisabled();
  expect(await submissions(page)).toHaveLength(1);
});

test("rejected ownership transfer keeps the exact recipient and phrase available for a deliberate retry", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=ownership&scenario=ownership-error`);
  const select = page.getByRole("combobox", { name: "New owner", exact: true });
  await select.selectOption("user_AdminA"); await page.getByLabel(phrase, { exact: true }).fill("Synthetic Practice");
  const button = page.getByRole("button", { name: `Transfer ownership to ${recipientA}`, exact: true });
  await button.click(); await expect(button).toBeEnabled();
  await expect(select).toHaveValue("user_AdminA"); await expect(page.getByLabel(phrase, { exact: true })).toHaveValue("Synthetic Practice");
  expect(await submissions(page)).toHaveLength(1);
  await button.click(); expect(await submissions(page)).toHaveLength(2);
});
