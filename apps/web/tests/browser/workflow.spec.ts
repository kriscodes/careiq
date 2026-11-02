import { test, expect } from "./harness";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => { await page.route("**/*", route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort("blockedbyclient")); });

test("preview shows synthetic readiness and persists a saved contact update", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await expect(page.getByText("All records are synthetic", { exact: false })).toBeVisible();
  await expect(page.getByText("Ready For Review", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("button", { name: /Alex Morgan.*View Profile/ }).click();
  await page.getByRole("button", { name: "Edit Contact" }).click();
  await page.getByLabel("Phone").fill("555-010-9876");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("alex@example.test · 555-010-9876")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("button", { name: /Alex Morgan.*View Profile/ }).click();
  await expect(page.getByText("alex@example.test · 555-010-9876")).toBeVisible();
});

test("failed save preserves the draft and reuses its idempotency key", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=save-failure`);
  await page.getByRole("button", { name: "＋ New Patient", exact: true }).click();
  await page.getByLabel("First Name").fill("Synthetic");
  await page.getByLabel("Last Name").fill("Patient");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The change could not be saved. Your entries are still here.");
  await expect(page.getByLabel("First Name")).toHaveValue("Synthetic");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const attempts = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand"));
  expect(attempts).toHaveLength(2);
  expect((attempts[0].input as { key: string }).key).toBe((attempts[1].input as { key: string }).key);
});

test("document review applies to a version and changes the visible state", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: /Insurance card Alex Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Version History" })).toBeVisible();
  await page.getByRole("button", { name: "Review This Version" }).click();
  await page.getByLabel("Review Note").fill("Synthetic review of exact version.");
  await page.getByRole("button", { name: "Save Review", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".wf-document-row").filter({ hasText: "Alex Morgan" }).getByText("Accepted", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand"));
  expect(calls[0].input).toMatchObject({ resource: "document-versions/v1/reviews", body: { decision: "accepted", expectedDocumentRevision: 1 } });
});

test("upload rejects unsupported file types and keeps the selected patient", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: /Upload Document/ }).click();
  await page.getByLabel("Patient", { exact: true }).selectOption("p1");
  await page.getByLabel("Document Type").selectOption("insurance");
  await page.getByLabel("File", { exact: false }).setInputFiles({ name: "unsafe.html", mimeType: "text/html", buffer: Buffer.from("<html>synthetic</html>") });
  await page.getByRole("button", { name: "Upload Document", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a PDF, JPEG, or PNG");
  await expect(page.getByLabel("Patient", { exact: true })).toHaveValue("p1");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("read-only permissions hide mutation controls and mobile layout has no overflow", async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`${harnessUrl}/?component=workflow&scenario=readonly`);
  await expect(page.getByText("You have read-only access", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /^＋ (New Patient|Book Appointment)$/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Expand Navigation", exact: true }).click();
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await expect(page.getByRole("button", { name: /New Template/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("patient signing removes link secrets and cannot complete without consent", async ({ page, harnessUrl }) => {
  let completed = false;
  await page.route("**/api/v1/patient-workflows/session-exchanges", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { requestId: "request-test", expiresAt: "2099-01-01" } }) }));
  await page.route("**/api/v1/patient-workflows/request", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "request-test", purpose: "signature", state: "open", revision: 1, recipientName: "Synthetic Patient", items: [], signature: { packetId: "packet-test", revision: 1, sourceSha256: "a".repeat(64), consentText: "Synthetic electronic consent.", consentTextVersion: "careiq-electronic-consent-v1", fields: [{ key: "patient_signature", type: "typed_signature", required: true }] } } }) }));
  await page.route("**/api/v1/patient-workflows/document", route => route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4 synthetic-only") }));
  await page.route("**/api/v1/patient-workflows/completion", async route => { completed = true; expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 1, consent: { accepted: true }, fields: [{ key: "patient_signature", type: "typed_signature", value: "Synthetic Patient" }] }); await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { state: "completed" } }) }); });
  await page.goto(`${harnessUrl}/?component=patient-workflow#token=synthetic-secret`);
  await expect(page.getByRole("heading", { name: "Review And Sign Your Document" })).toBeVisible();
  expect(page.url()).not.toContain("synthetic-secret");
  await expect(page.getByRole("button", { name: "Sign And Finish" })).toBeDisabled();
  await page.getByLabel("I have read the document and am ready to sign.").check();
  await page.getByLabel("Full Legal Name").fill("Synthetic Patient");
  await expect(page.getByRole("button", { name: "Sign And Finish" })).toBeDisabled();
  expect(completed).toBe(false);
  await page.getByLabel("I consent to use an electronic signature.").check();
  await page.getByRole("button", { name: "Sign And Finish" }).click();
  await expect(page.getByRole("heading", { name: "All signed. Thank you." })).toBeVisible();
  expect(completed).toBe(true);
});

test("booking and cancellation send the strict scheduling command payloads", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "＋ Book Appointment", exact: true }).click();
  await page.getByLabel("Patient", { exact: true }).selectOption("p1");
  await page.getByLabel("Date And Time", { exact: true }).fill("2026-10-16T14:00");
  await page.getByLabel("Reason For Visit", { exact: true }).fill("Synthetic scheduling check");
  await page.getByRole("button", { name: "Book Appointment", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Synthetic scheduling check/ }).click();
  await page.getByRole("button", { name: "Cancel Appointment", exact: true }).click();
  await page.getByLabel("Additional Details", { exact: true }).fill("Synthetic cancellation");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel Appointment", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect(commands[0].body).toMatchObject({ scheduledAt: "2026-10-16T21:00:00.000Z", endsAt: "2026-10-16T21:45:00.000Z", patientId: "p1" });
  expect(commands[0].body).not.toHaveProperty("durationMinutes");
  expect(commands[1].body).toEqual({ reasonCode: "patient_requested", note: "Synthetic cancellation" });
});

test("workflow setup adds a catalog entry and sends provider availability rules", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: "Add A Document Type", exact: true }).click();
  await page.getByLabel("Name", { exact: false }).fill("Synthetic referral");
  await page.getByLabel("Internal code", { exact: false }).fill("synthetic_referral");
  await page.getByRole("button", { name: "Save Configuration" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("4 document types", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set Provider Availability", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("dr1");
  await page.getByRole("button", { name: "Save Configuration" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect(commands[0]).toMatchObject({ resource: "document-types", body: { code: "synthetic_referral", name: "Synthetic referral" } });
  expect(commands[1].resource).toBe("providers/dr1/availability");
  expect(commands[1].body.rules).toHaveLength(5);
});

test("template field editor preserves answer types through publication and patient preparation", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: /New Template/ }).click();
  await page.getByLabel("Template Title", { exact: true }).fill("Synthetic typed form");
  await page.getByLabel("Document Type", { exact: true }).selectOption("intake");
  await page.getByLabel("Document Text", { exact: true }).fill("Synthetic form content.");
  await page.getByRole("button", { name: "＋ Add Field", exact: true }).click();
  await page.getByLabel("Field 1 Label").fill("I confirm these details");
  await page.getByLabel("Field 1 Type").selectOption("checkbox");
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Synthetic typed form/ }).click();
  await page.getByRole("button", { name: "Publish This Version" }).click();
  await expect(page.getByRole("article").getByText("Published", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare For Patient" }).click();
  await page.getByLabel("Patient", { exact: true }).selectOption("p1");
  await page.getByLabel("I confirm these details").check();
  await page.getByRole("button", { name: "Prepare Document", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect((commands[0].body.fieldSchema as Array<{ type: string }>)[0].type).toBe("checkbox");
  expect(Object.values(commands.at(-1)!.body.answers as Record<string, unknown>)).toEqual([true]);
});


test("resuming a collection request keeps fulfilled items received while other items stay uploadable", async ({ page, harnessUrl }) => {
  await page.route("**/api/v1/patient-workflows/session-exchanges", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { requestId: "request-test", expiresAt: "2099-01-01" } }) }));
  await page.route("**/api/v1/patient-workflows/request", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "request-test", purpose: "collection", state: "open", revision: 1, recipientName: "Synthetic Patient", items: [{ id: "received", requirementId: "requirement-a", label: "Received form", state: "fulfilled" }, { id: "missing", requirementId: "requirement-b", label: "Missing form", state: "open" }] } }) }));
  await page.goto(`${harnessUrl}/?component=patient-workflow#token=synthetic-secret`);
  await expect(page.getByRole("heading", { name: "Share The Documents Your Team Needs" })).toBeVisible();
  await expect(page.getByText("File received for processing. Your care team will review it.")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Upload Document", exact: true })).toHaveCount(1);
});


test("visit document actions review the clicked requirement instead of forcing a waiver", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.locator(".wf-visit").first().click();
  await page.getByRole("button", { name: "Actions For Insurance card", exact: true }).click();
  const chooser = page.getByRole("dialog");
  await expect(chooser.getByRole("button", { name: /Review Received Document/ })).toBeEnabled();
  await expect(chooser.getByRole("button", { name: /Upload A Replacement/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Request From Patient/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Waive Requirement/ })).toBeVisible();
  await chooser.getByRole("button", { name: /Review Received Document/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("Review Decision", { exact: true })).toHaveValue("accepted");
  await page.getByRole("button", { name: "Save Review", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ resource: "document-versions/v1/reviews", body: { decision: "accepted", expectedDocumentRevision: 1, requirementIds: ["r01"] } });
  await expect(page.locator(".wf-check-row").filter({ hasText: "Insurance card" })).toContainText("Satisfied");
});

test("requirement actions preserve visit context and keep waiver a deliberate choice", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.locator(".wf-visit").first().click();
  await page.getByRole("button", { name: "Actions For Insurance card", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Waive Requirement/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand"))).toHaveLength(0);
  await page.getByRole("button", { name: "Actions For Insurance card", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Request From Patient/ }).click();
  await expect(page.getByLabel("Patient", { exact: true })).toHaveValue("p1");
  await expect(page.getByLabel("Related Appointment", { exact: true })).toHaveValue("a1");
  await expect(page.getByLabel("Insurance card", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("forms studio saves real v2 commands, publishes locked versions, and discards hidden answers", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: "＋ New Form", exact: true }).click();
  const studio = page.getByRole("region", { name: "Forms Studio", exact: true });
  await expect(page.getByRole("button", { name: "Expand Navigation", exact: true })).toBeVisible();
  await studio.getByLabel("Form Title", { exact: true }).fill("Synthetic v2 intake");
  await studio.getByRole("button", { name: /^Document Type/ }).click();
  await expect(studio.getByRole("listbox")).toBeVisible();
  await studio.getByRole("option", { name: "Patient intake" }).click();
  await studio.getByLabel("Introduction & Document Text").fill("Synthetic form instructions.");
  await studio.getByRole("button", { name: "Checkbox", exact: true }).click();
  await studio.getByLabel("Field Label", { exact: true }).fill("Has allergies");
  await studio.getByRole("button", { name: "Long Answer", exact: true }).click();
  await studio.getByLabel("Field Label", { exact: true }).fill("Allergy details");
  await studio.getByLabel("Required Field", { exact: true }).check();
  await studio.getByRole("button", { name: /^Another Answer/ }).click();
  await studio.getByRole("option", { name: "Has allergies", exact: true }).click();
  await studio.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect(studio.getByText("Draft Saved", { exact: true })).toBeVisible();
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect(commands[0]).toMatchObject({ resource: "templates", body: { schemaVersion: 2, formSchema: { rules: [{ operator: "checked" }], completionPolicy: "form_only" } } });
  await studio.getByRole("button", { name: "Patient Preview", exact: true }).click();
  await expect(studio.getByLabel("Allergy details *", { exact: true })).toHaveCount(0);
  await studio.getByLabel("Has allergies", { exact: true }).check();
  await studio.getByLabel("Allergy details *", { exact: true }).fill("Synthetic branch answer");
  await studio.getByLabel("Has allergies", { exact: true }).uncheck();
  await studio.getByLabel("Has allergies", { exact: true }).check();
  await expect(studio.getByLabel("Allergy details *", { exact: true })).toHaveValue("");
  if (process.env.CAREIQ_CAPTURE_STUDIO === "1") {
    const directory = resolve(__dirname, "../../../../docs/verification/forms-studio-2026-10-17"); await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, "patient-preview-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 375, height: 900 }); await page.screenshot({ path: resolve(directory, "patient-preview-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 }); await studio.getByRole("button", { name: "Build", exact: true }).click();
    await page.screenshot({ path: resolve(directory, "forms-studio-desktop.png"), fullPage: true });
    await studio.getByRole("button", { name: /^Field Type/ }).click(); await page.screenshot({ path: resolve(directory, "forms-studio-open-dropdown.png"), fullPage: true });
    await studio.getByRole("listbox").press("Escape");
  }
  await studio.getByRole("button", { name: "Publish Version", exact: true }).click();
  await expect(studio.getByRole("button", { name: "Create Next Draft", exact: true })).toBeVisible();
  await studio.getByRole("button", { name: "Build", exact: true }).click();
  await expect(studio.getByLabel("Introduction & Document Text")).toBeDisabled();
  await studio.getByRole("button", { name: "Create Next Draft", exact: true }).click();
  await expect(studio.getByLabel("Introduction & Document Text")).toBeEnabled();
  await expect(studio.locator("select")).toHaveCount(0);
});

test("forms studio keeps white surfaces in dark mode and its roomy dropdown supports keyboard, Escape and outside close", async ({ page, harnessUrl }) => {
  await page.emulateMedia({ colorScheme: "dark" }); await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click(); await page.getByRole("button", { name: "＋ New Form", exact: true }).click();
  const studio = page.getByRole("region", { name: "Forms Studio", exact: true });
  expect(await studio.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  const trigger = studio.getByRole("button", { name: /^Document Type/ }); await trigger.focus(); await trigger.press("ArrowDown");
  const list = studio.getByRole("listbox"); await expect(list).toBeFocused();
  expect(await list.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await list.getByRole("option").first().evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThanOrEqual(12);
  await list.press("End"); await list.press("Enter"); await expect(trigger).toContainText("Patient intake");
  await trigger.click(); await list.press("Escape"); await expect(list).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await studio.getByRole("heading", { name: "New Form", exact: true }).click(); await expect(list).toHaveCount(0);
  for (const width of [1024, 736, 375, 320]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
});

test("patient form retries keep answers and mutation key, then freezes before signing", async ({ page, harnessUrl }) => {
  const fields = [{ key: "name", label: "Your name", type: "text", required: true }];
  const formSchema = { mode: "guided", defaultLocale: "en", completionPolicy: "form_then_sign", sections: [], rules: [], bindings: [], signing: { roles: [{ key: "patient", label: "Patient", required: true }], consentText: "Synthetic signing consent.", consentTextVersion: "synthetic-v1" }, delivery: { emailCopy: true } };
  let frozen = false; let saved = false; const saves: Array<{ key: string; body: unknown }> = [];
  await page.route("**/api/v1/patient-workflows/request", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "form-request", purpose: "paperwork", state: "open", revision: 1, recipientName: "Synthetic Patient", items: [], form: { preparedDocumentId: "prepared", templateVersionId: "tv1", title: "Synthetic intake", content: "Complete all required fields.", fields, formSchema, answers: saved ? { name: "Synthetic Patient" } : {}, revision: saved ? 2 : 1, state: frozen ? "ready" : "draft", completionPolicy: "form_then_sign" }, ...(frozen ? { signature: { packetId: "packet", revision: 1, sourceSha256: "a".repeat(64), consentText: "Synthetic signing consent.", consentTextVersion: "synthetic-v1", fields: [{ key: "patient_signature", type: "typed_signature", required: true }] } } : {}) } }) }));
  await page.route("**/api/v1/patient-workflows/form/answers", route => { const key = route.request().headers()["idempotency-key"]; saves.push({ key, body: route.request().postDataJSON() }); expect(route.request().method()).toBe("PUT"); expect(route.request().headers()["if-match"]).toBe('"1"'); if (saves.length === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE" } }) }); saved = true; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { revision: 2, answers: { name: "Synthetic Patient" } } }) }); });
  await page.route("**/api/v1/patient-workflows/form/freeze", route => { expect(saved).toBe(true); expect(route.request().headers()["if-match"]).toBe('"2"'); frozen = true; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { state: "ready" } }) }); });
  await page.route("**/api/v1/patient-workflows/document", route => route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4 synthetic") }));
  await page.goto(`${harnessUrl}/?component=patient-workflow`);
  await page.getByLabel("Your name *", { exact: true }).fill("Synthetic Patient"); await page.getByRole("button", { name: "Save Progress", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByLabel("Your name *", { exact: true })).toHaveValue("Synthetic Patient");
  await page.getByRole("button", { name: "Save Progress", exact: true }).click(); await expect(page.getByText("Your progress was saved.", { exact: true })).toBeVisible();
  expect(saves).toHaveLength(2); expect(saves[0].key).toBe(saves[1].key); expect(saves[1].body).toEqual({ answers: { name: "Synthetic Patient" } });
  await page.getByRole("button", { name: "Finish Form & Review Document", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review And Sign Your Document", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign And Finish", exact: true })).toBeDisabled(); expect(frozen).toBe(true);
});

test("patient paperwork library uses verified account API and exact version content without a request cookie", async ({ page, harnessUrl }) => {
  let requestedContent = false;
  await page.route("**/api/v1/patient-paperwork", route => { expect(route.request().headers().authorization).toBe("Bearer synthetic-browser-test-token"); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: [{ id: "copy1", documentVersionId: "immutable-v2", title: "Synthetic signed consent", versionNumber: 2, signed: true, completedAt: "2026-10-17T18:00:00Z", releaseState: "released" }], hasMore: false, nextCursor: null } }) }); });
  await page.route("**/api/v1/patient-paperwork/copy1/content", route => { requestedContent = true; expect(route.request().headers().authorization).toBe("Bearer synthetic-browser-test-token"); return route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4 exact synthetic copy") }); });
  await page.goto(`${harnessUrl}/?component=patient-paperwork`); await expect(page.getByRole("heading", { name: "Synthetic signed consent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open Exact Copy", exact: true }).click(); await expect(page.getByRole("link", { name: "Open Exact Copy", exact: true })).toBeVisible(); expect(requestedContent).toBe(true);
});


test("form-only completion confirms submission without reloading the closed patient request", async ({ page, harnessUrl }) => {
  let reads = 0;
  const formSchema = { mode: "guided", defaultLocale: "en", completionPolicy: "form_only", sections: [], rules: [], bindings: [], signing: { roles: [], consentText: "", consentTextVersion: "" }, delivery: { emailCopy: false } };
  await page.route("**/api/v1/patient-workflows/request", route => { reads++; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "unsigned-request", purpose: "form_completion", state: "open", revision: 1, items: [], form: { preparedDocumentId: "prepared", templateVersionId: "tv1", title: "Synthetic form", content: "Confirm information", fields: [], formSchema, answers: {}, revision: 1, state: "draft", completionPolicy: "form_only" } } }) }); });
  await page.route("**/api/v1/patient-workflows/form/freeze", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { state: "completed", signed: false, documentVersionId: "exact-unsigned" } }) }));
  await page.goto(`${harnessUrl}/?component=patient-workflow`);
  await page.getByRole("button", { name: "Submit Completed Form", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Form Was Submitted", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View My Paperwork", exact: true })).toHaveAttribute("href", "/patient-paperwork");
  await expect(page.getByText("No signature was requested.", { exact: false })).toBeVisible();
  expect(reads).toBe(1); await expect(page.getByRole("alert")).toHaveCount(0);
});

test("patient explicitly applies one signature to every assigned signature field and completes required name and date", async ({ page, harnessUrl }) => {
  const fields = [{ key: "treatment_signature", type: "typed_signature", required: true }, { key: "privacy_signature", type: "typed_signature", required: true }, { key: "patient_name", type: "name", required: true }, { key: "signed_date", type: "date", required: true }];
  let completed = false;
  await page.route("**/api/v1/patient-workflows/request", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "multi-signature", purpose: "signature", state: "open", revision: 1, items: [], signature: { packetId: "packet", revision: 1, sourceSha256: "a".repeat(64), consentText: "Synthetic electronic signature consent", consentTextVersion: "v1", fields } } }) }));
  await page.route("**/api/v1/patient-workflows/document", route => route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4 synthetic") }));
  await page.route("**/api/v1/patient-workflows/completion", route => { const body = route.request().postDataJSON(); expect(body.fields).toEqual([{ key: "treatment_signature", type: "typed_signature", value: "Synthetic Patient" }, { key: "privacy_signature", type: "typed_signature", value: "Synthetic Patient" }, { key: "patient_name", type: "text", value: "Synthetic Patient" }, { key: "signed_date", type: "date", value: "2026-10-17" }]); completed = true; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { state: "completed" } }) }); });
  await page.goto(`${harnessUrl}/?component=patient-workflow`);
  await expect(page.getByText("By choosing Sign and finish, I apply this signature to each field listed below in the document I reviewed.", { exact: true })).toBeVisible();
  await expect(page.getByText("Treatment Signature", { exact: true })).toBeVisible(); await expect(page.getByText("Privacy Signature", { exact: true })).toBeVisible();
  await page.getByLabel("I have read the document and am ready to sign.", { exact: true }).check();
  await page.getByLabel("I consent to use an electronic signature.", { exact: true }).check();
  await page.getByLabel("Full Legal Name", { exact: true }).fill("Synthetic Patient"); await page.getByLabel("Signed Date *", { exact: true }).fill("2026-10-17");
  await page.getByRole("button", { name: "Sign And Finish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All signed. Thank you.", exact: true })).toBeVisible(); expect(completed).toBe(true);
});

test("portal access manager uses the patient's exact account code, fresh verification, and revision-safe revocation", async ({ page, harnessUrl }) => {
  const patientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; const grantId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const grants: Array<Record<string, unknown>> = []; const bindings: Array<{ body: Record<string, unknown>; key: string }> = []; const revocations: Array<{ body: unknown; revision: string; key: string }> = [];
  await page.route(`**/workflow/paperwork/patients/${patientId}/portal-grants`, route => {
    if (route.request().method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: grants, adultSelfEligible: true, pagination: { nextCursor: null } } }) });
    bindings.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (bindings.length === 1) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "RECENT_AUTHENTICATION_REQUIRED" } }) });
    grants.push({ id: grantId, clerkUserId: "user_ExactPatient123", relationship: "self", verificationMethod: "staff_in_person", state: "active", verifiedAt: "2026-10-17T18:00:00Z", expiresAt: "2026-12-01T18:00:00Z", paperworkEmailEnabled: false, revision: 1 });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: grantId, state: "active", revision: 1 } }) });
  });
  await page.route(`**/workflow/paperwork/portal-grants/${grantId}/revocation`, route => { revocations.push({ body: route.request().postDataJSON(), revision: route.request().headers()["if-match"], key: route.request().headers()["idempotency-key"] }); grants[0] = { ...grants[0], state: "revoked", revokedAt: "2026-10-17T19:00:00Z", revision: 2 }; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: grants[0] }) }); });
  await page.goto(`${harnessUrl}/?component=portal-access`);
  await page.getByLabel("Patient Account Code", { exact: true }).fill("patient@example.test");
  await page.getByLabel("In-Person Verification Record", { exact: true }).fill("Synthetic in-person identity verification reference.");
  await page.getByLabel("I verified this adult patient in person", { exact: false }).check();
  await expect(page.getByRole("button", { name: "Grant Verified Access", exact: true })).toBeDisabled();
  await page.getByLabel("Patient Account Code", { exact: true }).fill("user_ExactPatient123"); await page.getByRole("button", { name: "Grant Verified Access", exact: true }).click();
  await expect(page.getByText("Active Access", { exact: true })).toBeVisible(); expect(bindings).toHaveLength(2); expect(bindings[0].key).toBe(bindings[1].key);
  expect(bindings[1].body).toEqual({ clerkUserId: "user_ExactPatient123", relationship: "self", verificationMethod: "staff_in_person", verificationReference: "Synthetic in-person identity verification reference.", paperworkEmailEnabled: false });
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "reverify").length)).toBe(1); expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "accessDenied").length)).toBe(0);
  await page.getByLabel("Reason For Revoking Access", { exact: true }).fill("patient_requested"); await page.getByRole("button", { name: "Revoke Access", exact: true }).click(); await expect(page.getByText("Revoked Access", { exact: true })).toBeVisible();
  expect(revocations).toHaveLength(1); expect(revocations[0]).toMatchObject({ body: { reasonCode: "patient_requested" }, revision: '"1"' });
  expect(await page.evaluate(() => JSON.stringify(localStorage).includes("user_ExactPatient123"))).toBe(false);
});

test("ordinary staff cannot see portal account bindings and patient account codes come from the signed-in account", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`); await page.getByRole("button", { name: "Patients", exact: true }).click(); await page.getByRole("button", { name: /Alex Morgan.*View Profile/ }).click(); await page.getByRole("button", { name: "Requests", exact: true }).click();
  await expect(page.getByRole("region", { name: "Verified Patient Portal Access", exact: true })).toHaveCount(0);
  await page.route("**/api/v1/patient-paperwork", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: [], hasMore: false, nextCursor: null } }) }));
  await page.goto(`${harnessUrl}/?component=patient-paperwork`); await expect(page.getByLabel("Patient Account Code", { exact: true })).toHaveValue("user_test"); await expect(page.getByRole("button", { name: "Copy Account Code", exact: true })).toBeVisible();
  await expect(page.getByLabel("Patient Account Code", { exact: true })).not.toHaveValue("owner@example.invalid");
});

test("insurance manager uses real queue actions and preserves unknown versus zero evidence benefits", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Manager", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A Clear View Of Your Day." })).toBeVisible();
  await expect(page.getByText("Payer connection unavailable.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open Insurance Queue", exact: false }).click();
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Unknown");
  await page.getByRole("button", { name: "Record Manual Verification", exact: true }).click();
  await page.getByLabel("Source Reference", { exact: true }).fill("SYNTHETIC CALL 123");
  await page.getByLabel("Copay (USD)", { exact: true }).fill("0");
  await page.getByLabel("Coverage Result", { exact: true }).selectOption("inactive");
  await expect(page.getByLabel("Copay (USD)", { exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog").last()).toContainText("Benefits remain unknown");
  await page.getByLabel("Coverage Result", { exact: true }).selectOption("active");
  await expect(page.getByLabel("Copay (USD)", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Save To Case History", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("$0.00");
  await expect(page.getByRole("dialog")).toContainText("Unknown");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Verification Evidence Recorded");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Correct Current Evidence", exact: true }).click();
  await page.getByLabel("Source Reference", { exact: true }).fill("SYNTHETIC CORRECTION");
  await page.getByLabel("Coverage Result", { exact: true }).selectOption("inactive");
  await page.getByRole("button", { name: "Save To Case History", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("SYNTHETIC CALL 123");
  await expect(page.getByRole("dialog")).toContainText("SYNTHETIC CORRECTION");
  await expect(page.getByRole("dialog")).toContainText("Historical");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Verification Evidence Corrected");
});

test("insurance lost-save retry keeps evidence entries and reuses one attempt key", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=insurance-save-failure`);
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Record Manual Verification", exact: true }).click();
  await page.getByLabel("Source Reference", { exact: true }).fill("SYNTHETIC RETRY");
  await page.getByRole("button", { name: "Save To Case History", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your entries are preserved");
  await expect(page.getByLabel("Source Reference", { exact: true })).toHaveValue("SYNTHETIC RETRY");
  await page.getByRole("button", { name: "Save To Case History", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "insuranceEvidence"));
  expect(calls).toHaveLength(2);
  expect((calls[0].input as { key: string }).key).toBe((calls[1].input as { key: string }).key);
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.locator(".ci-evidence")).toHaveCount(1);
});

test("insurance read-only grants keep the consistent menu and hide all mutation controls", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=insurance-readonly`);
  await expect(page.getByRole("navigation", { name: "Practice Navigation", exact: true }).getByRole("button", { name: "Manager", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await expect(page.getByRole("button", { name: "New Verification Case", exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record Manual Verification", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assign Or Schedule Follow-Up", exact: true })).toHaveCount(0);
});

test("insurance policy correction preserves masked ID and requires a new verification", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Correct Policy Details", exact: true }).click();
  await page.getByLabel("Payer", { exact: true }).fill("Synthetic corrected plan");
  await expect(page.getByLabel("Member ID Change", { exact: true })).toHaveValue("preserve");
  await page.getByRole("button", { name: "Save To Case History", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic corrected plan");
  await expect(page.getByRole("dialog")).toContainText("•••• 0123");
  await expect(page.getByRole("dialog")).toContainText("Unverified");
});

test("insurance views fit desktop and narrow web layouts", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Manager", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verification Outlook", exact: true })).toBeVisible();
  await expect(page.locator(".ci-metric")).toHaveCount(4);
  if (process.env.CAREIQ_CAPTURE_DESIGN === "1") {
    const directory = resolve(__dirname, "../../../../docs/verification/manager-insurance");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, "manager-desktop.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand Navigation", exact: true }).click();
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review Insurance For Alex Morgan", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAREIQ_CAPTURE_DESIGN === "1") {
    await page.screenshot({ path: resolve(__dirname, "../../../../docs/verification/manager-insurance/insurance-mobile.png"), fullPage: true });
  }
});


test("insurance manager export contains only authorized aggregate summary fields", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Manager", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Summary", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("careiq-manager-summary-2026-10-16.csv");
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, "utf8");
  expect(content).toContain("Tracked Insurance Cases");
  expect(content).toContain("Location Time Zone");
  expect(content).not.toContain("Alex Morgan");
  expect(content).not.toContain("Jordan Lee");
  expect(content).not.toContain("synthetic-insurance");
  expect(content).not.toContain("0123");
  await expect(page.getByRole("status").filter({ hasText: "Summary export authorized" })).toBeVisible();
});

for (const width of [320, 1280]) for (const colorScheme of ["light", "dark"] as const) test(`shared frame opens the requested Documents view and returns home at ${width}px ${colorScheme}`, async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme });
  await page.goto(`${harnessUrl}/?component=workflow&initialView=Documents&home=1`);
  await expect(page.getByRole("heading", { name: "Paperwork, In Its Place.", exact: true })).toBeVisible();
  if (width <= 760) await page.getByRole("button", { name: "Expand Navigation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Documents", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(width <= 760 ? ".wf-mobile-wordmark" : ".wf-application-logo .cq-a-wordmark")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(".wf-root").evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowHome"))).toHaveLength(1);
});

test("shared Home navigation confirms before leaving a dirty forms studio", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&initialView=Templates&home=1`);
  await page.getByRole("button", { name: "＋ New Form", exact: true }).click();
  const studio = page.getByRole("region", { name: "Forms Studio", exact: true });
  await studio.getByLabel("Form Title", { exact: true }).fill("Unfinished synthetic form");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(studio).toBeVisible();
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowHome"))).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Home", exact: true }).click();
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowHome"))).toHaveLength(1);
});


test("shared Settings header navigation confirms before leaving a dirty forms studio", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&initialView=Templates&headerTools=1`);
  const settings = page.getByRole("banner").getByRole("button", { name: "Practice Settings", exact: true });
  await page.getByRole("button", { name: "＋ New Form", exact: true }).click();
  const studio = page.getByRole("region", { name: "Forms Studio", exact: true });
  await studio.getByLabel("Form Title", { exact: true }).fill("Unfinished header navigation form");
  page.once("dialog", dialog => dialog.dismiss());
  await settings.click();
  await expect(studio.getByLabel("Form Title", { exact: true })).toHaveValue("Unfinished header navigation form");
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowSettings"))).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept());
  await settings.click();
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowSettings"))).toHaveLength(1);
});


test("switching practice confirms before activating another membership from a dirty forms studio", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&initialView=Templates&contextPicker=1&scenario=memberships-paged`);
  await page.getByRole("button", { name: "＋ New Form", exact: true }).click();
  const studio = page.getByRole("region", { name: "Forms Studio", exact: true });
  await studio.getByLabel("Form Title", { exact: true }).fill("Unfinished practice switch form");
  await expect(page.locator(".wf-application-symbol")).toBeVisible();
  await page.getByRole("button", { name: "Expand Navigation", exact: true }).click();
  const picker = page.getByRole("combobox", { name: "Your Practice", exact: true });
  page.once("dialog", dialog => dialog.dismiss());
  await picker.selectOption("org_other");
  await expect(picker).toHaveValue("org_test");
  await expect(studio.getByLabel("Form Title", { exact: true })).toHaveValue("Unfinished practice switch form");
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "setActive"))).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept());
  await picker.selectOption("org_other");
  await expect(picker).toHaveValue("org_other");
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "setActive"))).toEqual([{ name: "setActive", input: { organization: "org_other", hasNavigate: false } }]);
});

for (const phase of ["initial", "reload"] as const) test(`new workflow200 capabilities close an unauthorized Today view on ${phase} without retrying it`, async ({ page, harnessUrl }) => {
  const assigned = { id: "11111111-1111-4111-8111-111111111111", name: "Synthetic location", timeZone: "UTC", status: "active" };
  const previous = { patientsRead: false, appointmentsRead: true, documentsRead: true, configurationManage: false };
  const changed = { ...previous, appointmentsRead: false };
  let revoked = phase === "initial", reads = 0, checks = 0;
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const respond = (data: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
    if (path === "/api/v1/me") {
      checks++;
      const caps = reads && revoked ? changed : previous;
      return respond({ userId: "user_test", orgId: "org_test", practice: { id: "practice_test", name: "Synthetic practice", authorizationMode: "location", status: "active" }, onboarding: "ready", enrollmentStatus: "active", capabilities: { patients: { read: false, create: false }, appointments: { read: caps.appointmentsRead, create: false } }, workspaceCapabilities: caps, management: { locations: false, members: false }, locations: [assigned] });
    }
    if (path.endsWith("/workflow")) {
      reads++;
      return respond({ location: assigned, timeZone: "UTC", patients: [], appointments: [], documents: [], templates: [], requests: [], workItems: [], providers: [], visitTypes: [], documentTypes: [], capabilities: revoked ? changed : previous, summary: { activeAppointments: 7, appointmentsNeedingDocuments: 0, openWorkItems: 0 }, asOf: "2026-10-30T12:00:00Z" });
    }
    if (path.endsWith("/notifications")) return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [], unreadCount: 0 }) });
    return respond([]);
  });
  await page.goto(`${harnessUrl}/?component=workspace`);
  await page.getByRole("button", { name: "Open Workspace", exact: true }).click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  if (phase === "reload") {
    await expect(page.locator(".wf-kpis")).toBeVisible();
    await expect(page.locator(".wf-kpis")).toContainText("7");
    revoked = true;
    await page.getByRole("button", { name: "Refresh Today", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Hello again.", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Workspace access could not be confirmed. No records are open. Check your access before trying again." })).toBeVisible();
  await expect(page.locator(".wf-kpis")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Good morning, care team.", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Practice Navigation", exact: true }).locator('[aria-current="page"]')).toHaveAccessibleName("Home");
  const deniedReads = reads;
  expect(checks).toBe(2);
  await page.getByRole("button", { name: "Check Access Again", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hello again.", exact: true })).toBeVisible();
  expect(checks).toBe(3);
  expect(reads).toBe(deniedReads);
});
