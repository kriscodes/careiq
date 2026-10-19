import { test, expect } from "./harness";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => { await page.route("**/*", route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort("blockedbyclient")); });

test("preview shows synthetic readiness and persists a saved contact update", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await expect(page.getByText("All records are synthetic", { exact: false })).toBeVisible();
  await expect(page.getByText("Ready for review", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("button", { name: /Alex Morgan.*View profile/ }).click();
  await page.getByRole("button", { name: "Edit contact" }).click();
  await page.getByLabel("Phone").fill("555-010-9876");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("alex@example.test · 555-010-9876")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("button", { name: /Alex Morgan.*View profile/ }).click();
  await expect(page.getByText("alex@example.test · 555-010-9876")).toBeVisible();
});

test("failed save preserves the draft and reuses its idempotency key", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=save-failure`);
  await page.getByRole("button", { name: "＋ New patient", exact: true }).click();
  await page.getByLabel("First name").fill("Synthetic");
  await page.getByLabel("Last name").fill("Patient");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.test");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("The change could not be saved. Your entries are still here.");
  await expect(page.getByLabel("First name")).toHaveValue("Synthetic");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const attempts = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand"));
  expect(attempts).toHaveLength(2);
  expect((attempts[0].input as { key: string }).key).toBe((attempts[1].input as { key: string }).key);
});

test("document review applies to a version and changes the visible state", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: /Insurance card Alex Morgan/ }).click();
  await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  await page.getByRole("button", { name: "Review this version" }).click();
  await page.getByLabel("Review note").fill("Synthetic review of exact version.");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".wf-document-row").filter({ hasText: "Alex Morgan" }).getByText("accepted", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand"));
  expect(calls[0].input).toMatchObject({ resource: "document-versions/v1/reviews", body: { decision: "accepted", expectedDocumentRevision: 1 } });
});

test("upload rejects unsupported file types and keeps the selected patient", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: /Upload document/ }).click();
  await page.getByLabel("Patient", { exact: true }).selectOption("p1");
  await page.getByLabel("Document type").selectOption("insurance");
  await page.getByLabel("File", { exact: false }).setInputFiles({ name: "unsafe.html", mimeType: "text/html", buffer: Buffer.from("<html>synthetic</html>") });
  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a PDF, JPEG, or PNG");
  await expect(page.getByLabel("Patient", { exact: true })).toHaveValue("p1");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("read-only permissions hide mutation controls and mobile layout has no overflow", async ({ page, harnessUrl }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`${harnessUrl}/?component=workflow&scenario=readonly`);
  await expect(page.getByText("You have read-only access", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /^＋ (New patient|Book appointment)$/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await expect(page.getByRole("button", { name: /New template/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("patient signing removes link secrets and cannot complete without consent", async ({ page, harnessUrl }) => {
  let completed = false;
  await page.route("**/api/v1/patient-workflows/session-exchanges", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { requestId: "request-test", expiresAt: "2099-01-01" } }) }));
  await page.route("**/api/v1/patient-workflows/request", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "request-test", purpose: "signature", state: "open", revision: 1, recipientName: "Synthetic Patient", items: [], signature: { packetId: "packet-test", revision: 1, sourceSha256: "a".repeat(64), consentText: "Synthetic electronic consent.", consentTextVersion: "careiq-electronic-consent-v1", fields: [{ key: "patient_signature", type: "typed_signature", required: true }] } } }) }));
  await page.route("**/api/v1/patient-workflows/document", route => route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4 synthetic-only") }));
  await page.route("**/api/v1/patient-workflows/completion", async route => { completed = true; expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 1, consent: { accepted: true }, fields: [{ key: "patient_signature", type: "typed_signature", value: "Synthetic Patient" }] }); await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { state: "completed" } }) }); });
  await page.goto(`${harnessUrl}/?component=patient-workflow#token=synthetic-secret`);
  await expect(page.getByRole("heading", { name: "Review and sign your document" })).toBeVisible();
  expect(page.url()).not.toContain("synthetic-secret");
  await expect(page.getByRole("button", { name: "Sign and finish" })).toBeDisabled();
  await page.getByLabel("I have read the document and am ready to sign.").check();
  await page.getByLabel("Full legal name").fill("Synthetic Patient");
  await expect(page.getByRole("button", { name: "Sign and finish" })).toBeDisabled();
  expect(completed).toBe(false);
  await page.getByLabel("I consent to use an electronic signature.").check();
  await page.getByRole("button", { name: "Sign and finish" }).click();
  await expect(page.getByRole("heading", { name: "All signed. Thank you." })).toBeVisible();
  expect(completed).toBe(true);
});

test("booking and cancellation send the strict scheduling command payloads", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "＋ Book appointment", exact: true }).click();
  await page.getByLabel("Patient", { exact: true }).selectOption("p1");
  await page.getByLabel("Date and time", { exact: true }).fill("2026-10-16T14:00");
  await page.getByLabel("Reason for visit", { exact: true }).fill("Synthetic scheduling check");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Synthetic scheduling check/ }).click();
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await page.getByLabel("Additional details", { exact: true }).fill("Synthetic cancellation");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect(commands[0].body).toMatchObject({ scheduledAt: "2026-10-16T21:00:00.000Z", endsAt: "2026-10-16T21:45:00.000Z", patientId: "p1" });
  expect(commands[0].body).not.toHaveProperty("durationMinutes");
  expect(commands[1].body).toEqual({ reasonCode: "patient_requested", note: "Synthetic cancellation" });
});

test("workflow setup adds a catalog entry and sends provider availability rules", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: "Add a document type", exact: true }).click();
  await page.getByLabel("Name", { exact: false }).fill("Synthetic referral");
  await page.getByLabel("Internal code", { exact: false }).fill("synthetic_referral");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("4 document types", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Set provider availability", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("dr1");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect(commands[0]).toMatchObject({ resource: "document-types", body: { code: "synthetic_referral", name: "Synthetic referral" } });
  expect(commands[1].resource).toBe("providers/dr1/availability");
  expect(commands[1].body.rules).toHaveLength(5);
});

test("template field editor preserves answer types through publication and patient preparation", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: /New template/ }).click();
  await page.getByLabel("Template title", { exact: true }).fill("Synthetic typed form");
  await page.getByLabel("Document type", { exact: true }).selectOption("intake");
  await page.getByLabel("Document text", { exact: true }).fill("Synthetic form content.");
  await page.getByRole("button", { name: "＋ Add field", exact: true }).click();
  await page.getByLabel("Field 1 label").fill("I confirm these details");
  await page.getByLabel("Field 1 type").selectOption("checkbox");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Synthetic typed form/ }).click();
  await page.getByRole("button", { name: "Publish this version" }).click();
  await expect(page.getByText("published", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare for patient" }).click();
  await page.getByLabel("Patient", { exact: true }).selectOption("p1");
  await page.getByLabel("I confirm these details").check();
  await page.getByRole("button", { name: "Prepare document", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect((commands[0].body.fieldSchema as Array<{ type: string }>)[0].type).toBe("checkbox");
  expect(Object.values(commands.at(-1)!.body.answers as Record<string, unknown>)).toEqual([true]);
});


test("resuming a collection request keeps fulfilled items received while other items stay uploadable", async ({ page, harnessUrl }) => {
  await page.route("**/api/v1/patient-workflows/session-exchanges", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { requestId: "request-test", expiresAt: "2099-01-01" } }) }));
  await page.route("**/api/v1/patient-workflows/request", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "request-test", purpose: "collection", state: "open", revision: 1, recipientName: "Synthetic Patient", items: [{ id: "received", requirementId: "requirement-a", label: "Received form", state: "fulfilled" }, { id: "missing", requirementId: "requirement-b", label: "Missing form", state: "open" }] } }) }));
  await page.goto(`${harnessUrl}/?component=patient-workflow#token=synthetic-secret`);
  await expect(page.getByRole("heading", { name: "Share the documents your team needs" })).toBeVisible();
  await expect(page.getByText("File received for processing. Your care team will review it.")).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Upload document", exact: true })).toHaveCount(1);
});


test("visit document actions review the clicked requirement instead of forcing a waiver", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.locator(".wf-visit").first().click();
  await page.getByRole("button", { name: "Actions for Insurance card", exact: true }).click();
  const chooser = page.getByRole("dialog");
  await expect(chooser.getByRole("button", { name: /Review received document/ })).toBeEnabled();
  await expect(chooser.getByRole("button", { name: /Upload a replacement/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Request from patient/ })).toBeVisible();
  await expect(chooser.getByRole("button", { name: /Waive requirement/ })).toBeVisible();
  await chooser.getByRole("button", { name: /Review received document/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("Review decision", { exact: true })).toHaveValue("accepted");
  await page.getByRole("button", { name: "Save review", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ resource: "document-versions/v1/reviews", body: { decision: "accepted", expectedDocumentRevision: 1, requirementIds: ["r01"] } });
  await expect(page.locator(".wf-check-row").filter({ hasText: "Insurance card" })).toContainText("satisfied");
});

test("requirement actions preserve visit context and keep waiver a deliberate choice", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.locator(".wf-visit").first().click();
  await page.getByRole("button", { name: "Actions for Insurance card", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Waive requirement/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand"))).toHaveLength(0);
  await page.getByRole("button", { name: "Actions for Insurance card", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Request from patient/ }).click();
  await expect(page.getByLabel("Patient", { exact: true })).toHaveValue("p1");
  await expect(page.getByLabel("Related appointment", { exact: true })).toHaveValue("a1");
  await expect(page.getByLabel("Insurance card", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("forms studio saves real v2 commands, publishes locked versions, and discards hidden answers", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click();
  await page.getByRole("button", { name: "＋ New form", exact: true }).click();
  const studio = page.getByRole("region", { name: "Forms studio", exact: true });
  await expect(page.getByRole("button", { name: "Expand navigation", exact: true })).toBeVisible();
  await studio.getByLabel("Form title", { exact: true }).fill("Synthetic v2 intake");
  await studio.getByRole("button", { name: /^Document type/ }).click();
  await expect(studio.getByRole("listbox")).toBeVisible();
  await studio.getByRole("option", { name: "Patient intake" }).click();
  await studio.getByLabel("Introduction & document text").fill("Synthetic form instructions.");
  await studio.getByRole("button", { name: "Checkbox", exact: true }).click();
  await studio.getByLabel("Field label", { exact: true }).fill("Has allergies");
  await studio.getByRole("button", { name: "Long answer", exact: true }).click();
  await studio.getByLabel("Field label", { exact: true }).fill("Allergy details");
  await studio.getByLabel("Required field", { exact: true }).check();
  await studio.getByRole("button", { name: /^Another answer/ }).click();
  await studio.getByRole("option", { name: "Has allergies", exact: true }).click();
  await studio.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(studio.getByText("Draft saved", { exact: true })).toBeVisible();
  const commands = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "workflowCommand").map(call => call.input as { resource: string; body: Record<string, unknown> }));
  expect(commands[0]).toMatchObject({ resource: "templates", body: { schemaVersion: 2, formSchema: { rules: [{ operator: "checked" }], completionPolicy: "form_only" } } });
  await studio.getByRole("button", { name: "Patient preview", exact: true }).click();
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
    await studio.getByRole("button", { name: /^Field type/ }).click(); await page.screenshot({ path: resolve(directory, "forms-studio-open-dropdown.png"), fullPage: true });
    await studio.getByRole("listbox").press("Escape");
  }
  await studio.getByRole("button", { name: "Publish version", exact: true }).click();
  await expect(studio.getByRole("button", { name: "Create next draft", exact: true })).toBeVisible();
  await studio.getByRole("button", { name: "Build", exact: true }).click();
  await expect(studio.getByLabel("Introduction & document text")).toBeDisabled();
  await studio.getByRole("button", { name: "Create next draft", exact: true }).click();
  await expect(studio.getByLabel("Introduction & document text")).toBeEnabled();
  await expect(studio.locator("select")).toHaveCount(0);
});

test("forms studio keeps white surfaces in dark mode and its roomy dropdown supports keyboard, Escape and outside close", async ({ page, harnessUrl }) => {
  await page.emulateMedia({ colorScheme: "dark" }); await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Templates", exact: true }).click(); await page.getByRole("button", { name: "＋ New form", exact: true }).click();
  const studio = page.getByRole("region", { name: "Forms studio", exact: true });
  expect(await studio.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  const trigger = studio.getByRole("button", { name: /^Document type/ }); await trigger.focus(); await trigger.press("ArrowDown");
  const list = studio.getByRole("listbox"); await expect(list).toBeFocused();
  expect(await list.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await list.getByRole("option").first().evaluate(element => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThanOrEqual(12);
  await list.press("End"); await list.press("Enter"); await expect(trigger).toContainText("Patient intake");
  await trigger.click(); await list.press("Escape"); await expect(list).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click(); await studio.getByRole("heading", { name: "New form", exact: true }).click(); await expect(list).toHaveCount(0);
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
  await page.getByLabel("Your name *", { exact: true }).fill("Synthetic Patient"); await page.getByRole("button", { name: "Save progress", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByLabel("Your name *", { exact: true })).toHaveValue("Synthetic Patient");
  await page.getByRole("button", { name: "Save progress", exact: true }).click(); await expect(page.getByText("Your progress was saved.", { exact: true })).toBeVisible();
  expect(saves).toHaveLength(2); expect(saves[0].key).toBe(saves[1].key); expect(saves[1].body).toEqual({ answers: { name: "Synthetic Patient" } });
  await page.getByRole("button", { name: "Finish form & review document", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review and sign your document", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign and finish", exact: true })).toBeDisabled(); expect(frozen).toBe(true);
});

test("patient paperwork library uses verified account API and exact version content without a request cookie", async ({ page, harnessUrl }) => {
  let requestedContent = false;
  await page.route("**/api/v1/patient-paperwork", route => { expect(route.request().headers().authorization).toBe("Bearer synthetic-browser-test-token"); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: [{ id: "copy1", documentVersionId: "immutable-v2", title: "Synthetic signed consent", versionNumber: 2, signed: true, completedAt: "2026-10-17T18:00:00Z", releaseState: "released" }], hasMore: false, nextCursor: null } }) }); });
  await page.route("**/api/v1/patient-paperwork/copy1/content", route => { requestedContent = true; expect(route.request().headers().authorization).toBe("Bearer synthetic-browser-test-token"); return route.fulfill({ contentType: "application/pdf", body: Buffer.from("%PDF-1.4 exact synthetic copy") }); });
  await page.goto(`${harnessUrl}/?component=patient-paperwork`); await expect(page.getByRole("heading", { name: "Synthetic signed consent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open exact copy", exact: true }).click(); await expect(page.getByRole("link", { name: "Open exact copy", exact: true })).toBeVisible(); expect(requestedContent).toBe(true);
});


test("form-only completion confirms submission without reloading the closed patient request", async ({ page, harnessUrl }) => {
  let reads = 0;
  const formSchema = { mode: "guided", defaultLocale: "en", completionPolicy: "form_only", sections: [], rules: [], bindings: [], signing: { roles: [], consentText: "", consentTextVersion: "" }, delivery: { emailCopy: false } };
  await page.route("**/api/v1/patient-workflows/request", route => { reads++; return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { id: "unsigned-request", purpose: "form_completion", state: "open", revision: 1, items: [], form: { preparedDocumentId: "prepared", templateVersionId: "tv1", title: "Synthetic form", content: "Confirm information", fields: [], formSchema, answers: {}, revision: 1, state: "draft", completionPolicy: "form_only" } } }) }); });
  await page.route("**/api/v1/patient-workflows/form/freeze", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { state: "completed", signed: false, documentVersionId: "exact-unsigned" } }) }));
  await page.goto(`${harnessUrl}/?component=patient-workflow`);
  await page.getByRole("button", { name: "Submit completed form", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your form was submitted", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View my paperwork", exact: true })).toHaveAttribute("href", "/patient-paperwork");
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
  await expect(page.getByText("treatment signature", { exact: true })).toBeVisible(); await expect(page.getByText("privacy signature", { exact: true })).toBeVisible();
  await page.getByLabel("I have read the document and am ready to sign.", { exact: true }).check();
  await page.getByLabel("I consent to use an electronic signature.", { exact: true }).check();
  await page.getByLabel("Full legal name", { exact: true }).fill("Synthetic Patient"); await page.getByLabel("signed date *", { exact: true }).fill("2026-10-17");
  await page.getByRole("button", { name: "Sign and finish", exact: true }).click();
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
  await page.getByLabel("Patient account code", { exact: true }).fill("patient@example.test");
  await page.getByLabel("In-person verification record", { exact: true }).fill("Synthetic in-person identity verification reference.");
  await page.getByLabel("I verified this adult patient in person", { exact: false }).check();
  await expect(page.getByRole("button", { name: "Grant verified access", exact: true })).toBeDisabled();
  await page.getByLabel("Patient account code", { exact: true }).fill("user_ExactPatient123"); await page.getByRole("button", { name: "Grant verified access", exact: true }).click();
  await expect(page.getByText("Active access", { exact: true })).toBeVisible(); expect(bindings).toHaveLength(2); expect(bindings[0].key).toBe(bindings[1].key);
  expect(bindings[1].body).toEqual({ clerkUserId: "user_ExactPatient123", relationship: "self", verificationMethod: "staff_in_person", verificationReference: "Synthetic in-person identity verification reference.", paperworkEmailEnabled: false });
  expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "reverify").length)).toBe(1); expect(await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "accessDenied").length)).toBe(0);
  await page.getByLabel("Reason for revoking access", { exact: true }).fill("patient_requested"); await page.getByRole("button", { name: "Revoke access", exact: true }).click(); await expect(page.getByText("Revoked access", { exact: true })).toBeVisible();
  expect(revocations).toHaveLength(1); expect(revocations[0]).toMatchObject({ body: { reasonCode: "patient_requested" }, revision: '"1"' });
  expect(await page.evaluate(() => JSON.stringify(localStorage).includes("user_ExactPatient123"))).toBe(false);
});

test("ordinary staff cannot see portal account bindings and patient account codes come from the signed-in account", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`); await page.getByRole("button", { name: "Patients", exact: true }).click(); await page.getByRole("button", { name: /Alex Morgan.*View profile/ }).click(); await page.getByRole("button", { name: "Requests", exact: true }).click();
  await expect(page.getByRole("region", { name: "Verified patient portal access", exact: true })).toHaveCount(0);
  await page.route("**/api/v1/patient-paperwork", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: [], hasMore: false, nextCursor: null } }) }));
  await page.goto(`${harnessUrl}/?component=patient-paperwork`); await expect(page.getByLabel("Patient account code", { exact: true })).toHaveValue("user_test"); await expect(page.getByRole("button", { name: "Copy account code", exact: true })).toBeVisible();
  await expect(page.getByLabel("Patient account code", { exact: true })).not.toHaveValue("owner@example.invalid");
});

test("insurance manager uses real queue actions and preserves unknown versus zero evidence benefits", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Manager", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A clear view of your day." })).toBeVisible();
  await expect(page.getByText("Payer connection unavailable.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Open insurance queue", exact: false }).click();
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Unknown");
  await page.getByRole("button", { name: "Record manual verification", exact: true }).click();
  await page.getByLabel("Source reference", { exact: true }).fill("SYNTHETIC CALL 123");
  await page.getByLabel("Copay (USD)", { exact: true }).fill("0");
  await page.getByLabel("Coverage result", { exact: true }).selectOption("inactive");
  await expect(page.getByLabel("Copay (USD)", { exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog").last()).toContainText("Benefits remain unknown");
  await page.getByLabel("Coverage result", { exact: true }).selectOption("active");
  await expect(page.getByLabel("Copay (USD)", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Save to case history", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("$0.00");
  await expect(page.getByRole("dialog")).toContainText("Unknown");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Verification evidence recorded");
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await page.getByRole("button", { name: "Correct current evidence", exact: true }).click();
  await page.getByLabel("Source reference", { exact: true }).fill("SYNTHETIC CORRECTION");
  await page.getByLabel("Coverage result", { exact: true }).selectOption("inactive");
  await page.getByRole("button", { name: "Save to case history", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("SYNTHETIC CALL 123");
  await expect(page.getByRole("dialog")).toContainText("SYNTHETIC CORRECTION");
  await expect(page.getByRole("dialog")).toContainText("Historical");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Verification evidence corrected");
});

test("insurance lost-save retry keeps evidence entries and reuses one attempt key", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=insurance-save-failure`);
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Record manual verification", exact: true }).click();
  await page.getByLabel("Source reference", { exact: true }).fill("SYNTHETIC RETRY");
  await page.getByRole("button", { name: "Save to case history", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your entries are preserved");
  await expect(page.getByLabel("Source reference", { exact: true })).toHaveValue("SYNTHETIC RETRY");
  await page.getByRole("button", { name: "Save to case history", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const calls = await page.evaluate(() => window.__careiqMockCalls.filter(call => call.name === "insuranceEvidence"));
  expect(calls).toHaveLength(2);
  expect((calls[0].input as { key: string }).key).toBe((calls[1].input as { key: string }).key);
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Evidence", exact: true }).click();
  await expect(page.locator(".ci-evidence")).toHaveCount(1);
});

test("insurance read-only grants hide manager and all mutation controls", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow&scenario=insurance-readonly`);
  await expect(page.getByRole("button", { name: "Manager", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await expect(page.getByRole("button", { name: "New verification case", exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record manual verification", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assign or schedule follow-up", exact: true })).toHaveCount(0);
});

test("insurance policy correction preserves masked ID and requires a new verification", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await page.getByRole("button", { name: "Correct policy details", exact: true }).click();
  await page.getByLabel("Payer", { exact: true }).fill("Synthetic corrected plan");
  await expect(page.getByLabel("Member ID change", { exact: true })).toHaveValue("preserve");
  await page.getByRole("button", { name: "Save to case history", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic corrected plan");
  await expect(page.getByRole("dialog")).toContainText("•••• 0123");
  await expect(page.getByRole("dialog")).toContainText("Unverified");
});

test("insurance views fit desktop and narrow web layouts", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Manager", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verification outlook", exact: true })).toBeVisible();
  await expect(page.locator(".ci-metric")).toHaveCount(4);
  if (process.env.CAREIQ_CAPTURE_DESIGN === "1") {
    const directory = resolve(__dirname, "../../../../docs/verification/manager-insurance");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, "manager-desktop.png"), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Insurance", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review insurance for Alex Morgan", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAREIQ_CAPTURE_DESIGN === "1") {
    await page.screenshot({ path: resolve(__dirname, "../../../../docs/verification/manager-insurance/insurance-mobile.png"), fullPage: true });
  }
});


test("insurance manager export contains only authorized aggregate summary fields", async ({ page, harnessUrl }) => {
  await page.goto(`${harnessUrl}/?component=workflow`);
  await page.getByRole("button", { name: "Manager", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export summary", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("careiq-manager-summary-2026-10-16.csv");
  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path!, "utf8");
  expect(content).toContain("Tracked insurance cases");
  expect(content).toContain("Location time zone");
  expect(content).not.toContain("Alex Morgan");
  expect(content).not.toContain("Jordan Lee");
  expect(content).not.toContain("synthetic-insurance");
  expect(content).not.toContain("0123");
  await expect(page.getByRole("status").filter({ hasText: "Summary export authorized" })).toBeVisible();
});
