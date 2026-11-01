import { test, expect } from "./harness";
import type { Page } from "@playwright/test";
const archiveState = (status: "active" | "archiving" | "archived" | "restoring" = "active") => ({ status, archiveRequestedAt: status === "active" ? null : "2026-10-30T12:00:00.000Z", archivedAt: status === "archived" ? "2026-10-30T12:00:01.000Z" : null, restoredAt: null });
const pending = (action: "archive" | "delete") => ({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", action, status: "pending", requestedAt: "2026-10-30T12:00:00.000Z" });
async function account(page: Page, ownedPractices: { id: string; name: string }[] = [], closureRequest: ReturnType<typeof pending> | null = null) {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { account: archiveState(), ownedPractices, closureRequest } } }));
}
const calls = (page: Page, name: string) => page.evaluate(name => (window.__careiqMockCalls || []).filter(call => call.name === name), name);
test.beforeEach(async ({ page }) => { await page.route("**/*", async route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort()); });

test("personal account owners must hand off every practice, without exposing personal identity transfer", async ({ page, harnessUrl }) => {
  await account(page, [{ id: "practice_a", name: "Current practice" }, { id: "practice_b", name: "Another suspended practice" }]);
  await page.goto(`${harnessUrl}/?component=personal-account`);
  await expect(page.getByRole("heading", { name: "Personal account", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Practices you own" })).toHaveText(["Current practiceAnother suspended practice"]);
  await expect(page.getByText("Transfer ownership of every practice below before archiving your account or requesting deletion.", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByRole("button", { name: /Request account/ })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "New owner", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back", exact: true }).click(); expect(await calls(page, "accountBack")).toHaveLength(1);
});

test("a personal patient session can choose a request, must type exactly and resets confirmation on option changes", async ({ page, harnessUrl }) => {
  await account(page); const sent: unknown[] = [];
  await page.route("**/api/v1/account/closure-requests", async route => { sent.push(route.request().postDataJSON()); await route.fulfill({ status: 202, json: { data: pending("delete") } }); });
  await page.goto(`${harnessUrl}/?component=personal-account&scenario=no-active-organization&identityRole=patient`);
  const archive = page.getByRole("button", { name: "Archive my account", exact: true });
  await expect(archive).toBeDisabled();
  for (const text of ["archive", " ARCHIVE", "ARCHIV"]) { await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill(text); await expect(archive).toBeDisabled(); }
  await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await expect(archive).toBeEnabled();
  await page.getByRole("radio", { name: /^Request deletion/ }).check();
  await expect(page.getByLabel("Type DELETE to confirm", { exact: true })).toHaveValue("");
  const submit = page.getByRole("button", { name: "Request account deletion", exact: true }); await expect(submit).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE"); await submit.click();
  await expect(page.getByText("Your deletion request is pending. Your account has not been deleted.", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0); expect(sent).toEqual([{ action: "delete", confirmation: "DELETE" }]);
  expect((await calls(page, "getToken")).every(call => (call.input as { skipCache: boolean }).skipCache)).toBe(true);
});

test("a stale factor triggers provider reverification before completing an immediate archive", async ({ page, harnessUrl }) => {
  await account(page); let attempts = 0;
  await page.route("**/api/v1/account/archive", async route => { attempts++; await route.fulfill(attempts === 1 ? { status: 403, json: { error: { code: "RECENT_AUTHENTICATION_REQUIRED" } } } : { status: 200, json: { data: archiveState("archived") } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toBeVisible();
  expect(attempts).toBe(2); expect(await calls(page, "reverify")).toHaveLength(1);
});

test("cancelled reverification leaves the closure request unsubmitted and permits a deliberate retry", async ({ page, harnessUrl }) => {
  await account(page); let attempts = 0;
  await page.route("**/api/v1/account/archive", route => { attempts++; return route.fulfill({ status: 403, json: { error: { code: "RECENT_AUTHENTICATION_REQUIRED" } } }); });
  await page.goto(`${harnessUrl}/?component=personal-account&scenario=reverification-cancel`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE");
  const submit = page.getByRole("button", { name: "Archive my account", exact: true }); await submit.click();
  await expect(page.getByRole("alert")).toHaveText("Verification was cancelled. Your request was not submitted."); await expect(submit).toBeEnabled(); expect(attempts).toBe(1);
  await expect(page.getByLabel("Type ARCHIVE to confirm", { exact: true })).toHaveValue("ARCHIVE"); await expect(page.getByRole("heading", { name: "Request received" })).toHaveCount(0);
});

test("a pending request loads honestly after navigation and keeps the page white at 320px under dark system settings", async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width: 320, height: 850 }); await page.emulateMedia({ colorScheme: "dark" }); await account(page, [], pending("delete"));
  await page.goto(`${harnessUrl}/?component=personal-account&identityRole=member`);
  await expect(page.getByText("Your deletion request is pending. Your account has not been deleted.", { exact: true })).toBeVisible();
  await expect(page.getByText("Your sign-in remains available while this request is reviewed.", { exact: true })).toBeVisible(); await expect(page.getByRole("radio")).toHaveCount(0);
  expect(await page.locator(".cq-access").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("heading", { name: "Personal account", exact: true }).focus(); await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Back", exact: true })).toBeFocused();
});

test("an in-flight closure locks the action and prevents duplicate submissions", async ({ page, harnessUrl }) => {
  await account(page); let attempts = 0; let finish: (() => void) | undefined;
  await page.route("**/api/v1/account/archive", async route => { attempts++; await new Promise<void>(resolve => { finish = resolve; }); await route.fulfill({ status: 200, json: { data: archiveState("archived") } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE");
  await page.getByRole("button", { name: "Archive my account", exact: true }).dblclick();
  await expect(page.getByRole("button", { name: "Archiving…", exact: true })).toBeDisabled(); await expect(page.getByLabel("Type ARCHIVE to confirm", { exact: true })).toBeDisabled(); await expect(page.getByRole("radio").first()).toBeDisabled(); await expect.poll(() => attempts).toBe(1);
  finish!(); await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toBeVisible();
});

test("the standalone personal view has its production styles and uses the shared contextual loader", async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width: 320, height: 850 }); await page.emulateMedia({ colorScheme: "dark" });
  let finish: (() => void) | undefined;
  await page.route("**/api/v1/account", async route => { await new Promise<void>(resolve => { finish = resolve; }); await route.fulfill({ json: { data: { account: archiveState(), ownedPractices: [], closureRequest: null } } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`);
  await expect(page.locator(".careiq.cq-settings-host > .cq-access .cq-a-loading-panel")).toBeVisible();
  await expect(page.locator(".cq-a-loading-panel")).toHaveText("Loading your account…");
  await expect.poll(() => Boolean(finish)).toBe(true); finish!();
  const confirmation = page.getByLabel("Type ARCHIVE to confirm", { exact: true }); await expect(confirmation).toBeVisible();
  expect(await confirmation.evaluate(element => ({ border: getComputedStyle(element).borderTopWidth, display: getComputedStyle(element).display }))).toEqual({ border: "1px", display: "block" });
  expect(await page.locator(".cq-settings-host").evaluate(element => getComputedStyle(element).padding)).toBe("0px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".cq-access").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
});

for (const status of [401, 403]) test(`a closure POST ${status} clears the stale personal summary and confirmation`, async ({ page, harnessUrl }) => {
  await account(page);
  await page.route("**/api/v1/account/archive", route => route.fulfill({ status, json: { error: { code: status === 401 ? "UNAUTHENTICATED" : "ACCOUNT_UNAVAILABLE" } } }));
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByLabel("Type ARCHIVE to confirm", { exact: true })).toHaveCount(0); await expect(page.locator(".cq-a-loading")).toHaveCount(0); await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

test("new ownership discovered on submission refreshes every owned practice while retaining the denial", async ({ page, harnessUrl }) => {
  let loads = 0;
  await page.route("**/api/v1/account", route => { loads++; return route.fulfill({ json: { data: { account: archiveState(), ownedPractices: loads === 1 ? [] : [{ id: "new_owner", name: "Newly owned practice" }], closureRequest: null } } }); });
  await page.route("**/api/v1/account/archive", route => route.fulfill({ status: 409, json: { error: { code: "ACCOUNT_OWNS_PRACTICES" } } }));
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("list", { name: "Practices you own" })).toContainText("Newly owned practice"); await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("radio")).toHaveCount(0); expect(loads).toBe(2);
});

test("a factor that remains stale after the provider prompt never produces an accepted request", async ({ page, harnessUrl }) => {
  await account(page); let attempts = 0;
  await page.route("**/api/v1/account/archive", route => { attempts++; return route.fulfill({ status: 403, json: { error: { code: "RECENT_AUTHENTICATION_REQUIRED" } } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByLabel("Type ARCHIVE to confirm", { exact: true })).toHaveValue("ARCHIVE"); await expect(page.getByRole("button", { name: "Archive my account", exact: true })).toBeEnabled(); await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toHaveCount(0); expect(attempts).toBe(2);
});

test("patient personal-account navigation revokes opened copies and Back checks current access again", async ({ page, harnessUrl }) => {
  let reads = 0; let revoked = false;
  await page.addInitScript(() => {
    const evidence = { created: [] as string[], revoked: [] as string[] };
    Object.assign(window, { __accountBlobEvidence: evidence });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); evidence.created.push(url); return url; };
    URL.revokeObjectURL = value => { evidence.revoked.push(value); revoke(value); };
  });
  await page.route("**/api/v1/patient-paperwork", route => { reads++; return route.fulfill(!revoked ? { json: { data: { items: [{ id: "copy1", documentVersionId: "version1", title: "Synthetic retained copy", versionNumber: 1, signed: true, completedAt: "2026-10-30T12:00:00Z", releaseState: "released" }], hasMore: false, nextCursor: null } } } : { status: 403, json: { error: { code: "PAPERWORK_UNAVAILABLE" } } }); });
  await page.route("**/api/v1/patient-paperwork/communication-preferences", route => route.fulfill({ json: { data: { profiles: [] } } }));
  await page.route("**/api/v1/patient-paperwork/copy1/content", route => route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4 synthetic account navigation fixture") }));
  await account(page);
  await page.goto(`${harnessUrl}/?component=patient-paperwork&scenario=no-active-organization`);
  await expect(page.getByRole("heading", { name: "Synthetic retained copy", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open exact copy", exact: true }).click(); await expect(page.getByRole("link", { name: "Open exact copy", exact: true })).toBeVisible();
  revoked = true; const beforeReturn = reads;
  await page.getByRole("button", { name: "Personal account", exact: true }).click(); await expect(page.getByRole("heading", { name: "Personal account", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Synthetic retained copy", exact: true })).toHaveCount(0); await expect(page.getByRole("link", { name: "Open exact copy", exact: true })).toHaveCount(0);
  const evidence = await page.evaluate(() => (window as unknown as { __accountBlobEvidence: { created: string[]; revoked: string[] } }).__accountBlobEvidence);
  expect(evidence.created).toHaveLength(1); expect(evidence.revoked).toEqual(evidence.created);
  await page.getByRole("button", { name: "Back", exact: true }).click(); await expect.poll(() => reads > beforeReturn).toBe(true);
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("heading", { name: "Synthetic retained copy", exact: true })).toHaveCount(0); await expect(page.getByRole("link", { name: "Open exact copy", exact: true })).toHaveCount(0);
});

test("immediate archive submits only the exact confirmation and shows the completed receipt before sign-out", async ({ page, harnessUrl }) => {
  await account(page); const sent: unknown[] = [];
  await page.route("**/api/v1/account/archive", async route => { sent.push(route.request().postDataJSON()); await route.fulfill({ status: 200, json: { data: archiveState("archived") } }); });
  await page.goto(`${harnessUrl}/?component=personal-account&scenario=no-active-organization`);
  await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toBeVisible();
  await expect(page.getByText("Sign-in is disabled. Practice, patient and audit records are retained. Contact support to restore your account.", { exact: true })).toBeVisible();
  expect(sent).toEqual([{ confirmation: "ARCHIVE" }]); expect(await calls(page, "signOut")).toHaveLength(0);
  await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); expect(await calls(page, "signOut")).toHaveLength(1);
});

test("a provider-incomplete archive refreshes blocked state and offers a fresh exact-confirmation retry", async ({ page, harnessUrl }) => {
  let incomplete = false, attempts = 0;
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { account: archiveState(incomplete ? "archiving" : "active"), ownedPractices: [], closureRequest: null } } }));
  await page.route("**/api/v1/account/archive", route => { attempts++; incomplete = true; return route.fulfill(attempts === 1 ? { status: 503, json: { error: { code: "ACCOUNT_ARCHIVE_INCOMPLETE" } } } : { status: 200, json: { data: archiveState("archived") } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive in progress", exact: true })).toBeVisible(); await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /^Request deletion/ })).toHaveCount(0); await expect(page.getByLabel("Type ARCHIVE to confirm", { exact: true })).toHaveValue("");
  const retry = page.getByRole("button", { name: "Finish account archive", exact: true }); await expect(retry).toBeDisabled(); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await retry.click();
  await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toBeVisible(); expect(attempts).toBe(2);
});

test("a restoration in progress stays blocked without exposing a self-service restore or delete action", async ({ page, harnessUrl }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { account: archiveState("restoring"), ownedPractices: [], closureRequest: null } } }));
  await page.goto(`${harnessUrl}/?component=personal-account`); await expect(page.getByRole("heading", { name: "Restoration in progress", exact: true })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
});

test("a lost archive response clears the old active options and reloads the durable completed state", async ({ page, harnessUrl }) => {
  let archived = false, posts = 0;
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { account: archiveState(archived ? "archived" : "active"), ownedPractices: [], closureRequest: null } } }));
  await page.route("**/api/v1/account/archive", async route => { posts++; archived = true; await route.abort("failed"); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toBeVisible(); await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByLabel("Type ARCHIVE to confirm", { exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible(); expect(posts).toBe(1);
});

test("an interrupted archive takes precedence over an existing deletion request and remains resumable", async ({ page, harnessUrl }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { account: archiveState("archiving"), ownedPractices: [], closureRequest: pending("delete") } } }));
  let attempts = 0;
  await page.route("**/api/v1/account/archive", route => { attempts++; return route.fulfill({ status: 200, json: { data: archiveState("archived") } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await expect(page.getByRole("heading", { name: "Archive in progress", exact: true })).toBeVisible();
  await expect(page.getByText("Your sign-in remains available while this request is reviewed.", { exact: true })).toHaveCount(0); await expect(page.getByRole("heading", { name: "Request received", exact: true })).toHaveCount(0);
  await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Finish account archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account archived", exact: true })).toBeVisible(); expect(attempts).toBe(1);
});

test("restoration discovered during submission refreshes blocked status instead of preserving old active controls", async ({ page, harnessUrl }) => {
  let restoring = false;
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { account: archiveState(restoring ? "restoring" : "active"), ownedPractices: [], closureRequest: null } } }));
  await page.route("**/api/v1/account/archive", route => { restoring = true; return route.fulfill({ status: 409, json: { error: { code: "ACCOUNT_RESTORE_INCOMPLETE" } } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByLabel("Type ARCHIVE to confirm", { exact: true }).fill("ARCHIVE"); await page.getByRole("button", { name: "Archive my account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Restoration in progress", exact: true })).toBeVisible(); await expect(page.getByRole("radio")).toHaveCount(0); await expect(page.getByRole("button", { name: "Archive my account", exact: true })).toHaveCount(0);
});

test("reloading an interrupted archive discards a previously selected deletion action", async ({ page, harnessUrl }) => {
  let archiving = false;
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { account: archiveState(archiving ? "archiving" : "active"), ownedPractices: [], closureRequest: null } } }));
  await page.route("**/api/v1/account/closure-requests", route => { archiving = true; return route.fulfill({ status: 403, json: { error: { code: "ACCOUNT_ARCHIVED" } } }); });
  await page.goto(`${harnessUrl}/?component=personal-account`); await page.getByRole("radio", { name: /^Request deletion/ }).check(); await page.getByLabel("Type DELETE to confirm", { exact: true }).fill("DELETE"); await page.getByRole("button", { name: "Request account deletion", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive in progress", exact: true })).toBeVisible(); await expect(page.getByLabel("Type DELETE to confirm", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Type ARCHIVE to confirm", { exact: true })).toHaveValue(""); await expect(page.getByRole("button", { name: "Finish account archive", exact: true })).toBeDisabled();
  await expect(page.getByRole("radio")).toHaveCount(1); await expect(page.getByRole("radio")).toBeChecked();
});
