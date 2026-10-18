import { test, expect } from "./harness";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort("blockedbyclient"));
  await page.route("**/api/v1/me", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { userId: "user_test", orgId: "org_test", practice: { id: "practice_test", name: "Synthetic practice", authorizationMode: "location", status: "active" }, enrollmentStatus: "active", onboarding: "ready", capabilities: {}, management: {}, locations: [{ id: "location_a", name: "Synthetic location A" }, { id: "location_b", name: "Synthetic location B" }] } }) }));
});

test("audit requires a purpose, requests explicit evidence and clears records on a location change", async ({ page, harnessUrl }) => {
  let searches = 0;
  await page.route("**/audit/events?*", route => {
    searches++;
    expect(route.request().headers()["x-audit-purpose"]).toBe("Synthetic case");
    expect(new URL(route.request().url()).searchParams.get("includeEvidence")).toBe("true");
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: "event_a", action: "synthetic.patient.read", actorType: "user", actorId: "synthetic_actor", entityType: "patient", outcome: "succeeded", recordedAt: "2026-10-16T12:00:00Z" }], pagination: { hasMore: false, nextCursor: null } }) });
  });
  await page.route("**/audit/events/event_a?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "event_a", action: "synthetic.patient.read", actorType: "user", actorId: "synthetic_actor", entityType: "patient", outcome: "succeeded", recordedAt: "2026-10-16T12:00:00Z", databaseRecords: [{ id: "db_a", tableName: "patients", operation: "UPDATE", changedFields: ["revision"], authenticatedLogin: "synthetic_reader" }] } }) }));
  await page.goto(`${harnessUrl}/?component=audit`);
  await page.getByLabel("Working location").selectOption("location_a");
  await page.getByRole("button", { name: "Search audit history" }).click();
  expect(searches).toBe(0);
  await page.getByLabel("Purpose or case reference").fill("Synthetic case");
  await page.getByLabel("Include database evidence", { exact: false }).check();
  await page.getByRole("button", { name: "Search audit history" }).click();
  await expect(page.getByRole("cell").filter({ hasText: "synthetic.patient.read" })).toBeVisible();
  await page.getByRole("button", { name: "Open details" }).click();
  await expect(page.getByRole("heading", { name: "Database evidence" })).toBeVisible();
  await page.getByLabel("Working location").selectOption("location_b");
  await expect(page.getByText("synthetic_actor")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("late audit responses cannot reappear after changing the working location", async ({ page, harnessUrl }) => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/audit/events?*", async route => {
    started(); await delayed;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: "late", action: "late.protected.result", actorType: "user", actorId: "late_actor", entityType: "patient", outcome: "succeeded", recordedAt: "2026-10-16T12:00:00Z" }], pagination: { hasMore: false, nextCursor: null } }) }).catch(() => {});
  });
  await page.goto(`${harnessUrl}/?component=audit`);
  await page.getByLabel("Working location").selectOption("location_a");
  await page.getByLabel("Purpose or case reference").fill("Synthetic case");
  await page.getByRole("button", { name: "Search audit history" }).click();
  await requestStarted;
  await page.getByLabel("Working location").selectOption("location_b");
  release();
  await expect(page.getByRole("button", { name: "Search audit history" })).toBeEnabled();
  await expect(page.getByText("late · protected · result")).toHaveCount(0);
  await expect(page.getByRole("table")).toHaveCount(0);
});
