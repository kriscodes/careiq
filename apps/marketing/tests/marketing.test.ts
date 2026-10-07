import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { content, validateContent } from "../src/content/content";
import { parseSiteConfig } from "../src/lib/config";
import { prepareSubmission, submitInterview, type FormValues } from "../src/lib/submission";
import Home from "../src/app/page";
import Privacy from "../src/app/privacy/page";
import { InterviewForm } from "../src/components/InterviewForm";

const key = "8fbfdad1-d503-46d0-9e91-d351710d57b6";
const nextKey = "2b0f2978-9ed2-446b-bce4-4eb3f4157e8a";
const values: FormValues = { name: "Test Contact", email: "test@gmail.com", role: "practice_manager", practiceName: "Example Practice", website: "" };
const request = prepareSubmission(values, null, () => key);
assert.equal(request.parsed.ok, true);
if (!request.parsed.ok) throw new Error("Invalid test fixture");
const payload = request.parsed.data;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

// These are client-contract tests, not proof of database persistence or permissions.
test("central copy validates, catches blank copy and empty FAQs, and preserves machine role values", () => {
  assert.equal(validateContent(content).hero.headline, "A simpler path from new-patient request to scheduled appointment.");
  assert.throws(() => validateContent({ ...content, hero: { ...content.hero, headline: " " } }), /must not be blank/);
  assert.throws(() => validateContent({ ...content, faq: { ...content.faq, items: [] } }), /must not be empty/);
  const edited = structuredClone(content);
  edited.form.roleLabels.practice_manager = "Manager of a practice";
  assert.equal(validateContent(edited).form.roleLabels.practice_manager, "Manager of a practice");
  assert.equal(payload.role, "practice_manager");
});

test("information renders with no Clerk, API, database, or submission configuration", () => {
  const home = renderToStaticMarkup(createElement(Home));
  const privacy = renderToStaticMarkup(createElement(Privacy));
  assert.match(home, /A simpler path from new-patient request/);
  assert.match(home, /Illustrative workflow/);
  assert.match(privacy, /Website privacy notice/);
  assert.doesNotMatch(home + privacy, /clerk|\/api\/v1\/me|postgresql:\/\//i);
  const unavailable = renderToStaticMarkup(createElement(InterviewForm, { copy: content.form, enabled: false }));
  assert.match(unavailable, /Interview requests are temporarily unavailable/);
  assert.match(unavailable, /fieldset disabled/);
  assert.doesNotMatch(unavailable, /type="file"|type="tel"|textarea/);
});

test("configuration trims URLs, never silently points API at localhost, and gates indexing", () => {
  const defaults = parseSiteConfig({});
  assert.equal(defaults.apiUrl, undefined);
  assert.equal(defaults.submissionEnabled, false);
  assert.equal(defaults.allowIndexing, false);
  assert.equal(defaults.siteUrl, "https://careiqlabs.com");
  const configured = parseSiteConfig({ apiUrl: " https://api.example.com/// ", privacyEmail: "privacy@example.com", allowIndexing: "true" });
  assert.equal(configured.apiUrl, "https://api.example.com");
  assert.equal(configured.submissionEnabled, true);
  assert.throws(() => parseSiteConfig({ allowIndexing: "true" }), /Public indexing requires/);
  assert.throws(() => parseSiteConfig({ siteUrl: "https://preview.example.com", apiUrl: "https://api.example.com", privacyEmail: "privacy@example.com", allowIndexing: "true" }), /Public indexing requires/);
  assert.throws(() => parseSiteConfig({ apiUrl: "https://api.example.com/api/v1" }), /without \/api\/v1/);
  assert.throws(() => parseSiteConfig({ apiUrl: "http://api.example.com" }), /HTTPS/);
  assert.throws(() => parseSiteConfig({ apiUrl: "https://user:password@api.example.com" }), /without credentials/);
  assert.throws(() => parseSiteConfig({ privacyEmail: "privacy@example.com?subject=x" }), /valid public email/);
  assert.throws(() => parseSiteConfig({ founderLinkedinUrl: "https://not-linkedin.example.com" }), /LinkedIn/);
  assert.equal(parseSiteConfig({ apiUrl: "http://localhost:3000" }).apiUrl, "http://localhost:3000");
});

test("client validation rejects missing fields and permits ordinary general-provider email", () => {
  const empty = prepareSubmission({ ...values, name: "", email: "", role: "" }, null, () => key);
  assert.equal(empty.parsed.ok, false);
  if (!empty.parsed.ok) assert.deepEqual(empty.parsed.fields, { name: "required", email: "required", role: "required" });
  assert.equal(prepareSubmission(values, null, () => key).parsed.ok, true);
  assert.equal(prepareSubmission({ ...values, email: "not an email" }, null, () => key).parsed.ok, false);
});

test("retries keep their submission key, changes generate a new one, and form values are preserved", async () => {
  const originalValues = structuredClone(values);
  const failed = await submitInterview("https://api.example.com", payload, async () => { throw new TypeError("network failure"); });
  assert.deepEqual(failed, { kind: "error" });
  const retry = prepareSubmission(values, request.attempt, () => { throw new Error("Must reuse the reference"); });
  assert.equal(retry.attempt.key, key);
  const edited = prepareSubmission({ ...values, name: "Changed Contact" }, request.attempt, () => nextKey);
  assert.equal(edited.attempt.key, nextKey);
  assert.deepEqual(values, originalValues);
});

test("submissions use the configured API origin, omit credentials, and only accept confirmed success", async () => {
  let calls = 0;
  const result = await submitInterview("https://configured-api.example.com/", payload, async (url, options) => {
    calls++;
    assert.equal(url, "https://configured-api.example.com/api/v1/public/interview-requests");
    assert.equal(options?.method, "POST");
    assert.equal(options?.credentials, "omit");
    assert.equal(options?.cache, "no-store");
    assert.ok(options?.signal);
    assert.deepEqual(JSON.parse(String(options?.body)), payload);
    return json({ data: { accepted: true } });
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { kind: "success" });
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => json({ data: { accepted: false } })), { kind: "error" });
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => json({ message: "ok" })), { kind: "error" });
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => new Response("not JSON")), { kind: "error" });
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => json({ data: { accepted: true } }, 500)), { kind: "error" });
});

test("validation, rate limit, unavailability, and internal failures become safe UI outcomes", async () => {
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => json({ error: { fields: { email: "invalid", name: "untrusted server text", privateValue: "contact@example.com" } } }, 400)), { kind: "invalid", fields: { email: "invalid" } });
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => json({}, 429)), { kind: "rateLimited" });
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => json({}, 503)), { kind: "unavailable" });
  assert.deepEqual(await submitInterview("https://api.example.com", payload, async () => json({ error: { message: "SQL secret or contact details" } }, 500)), { kind: "error" });
});

// Regression: without hydration a native GET must never put contact fields in URLs.
test("server-rendered configured form waits for hydration and never defaults to GET", () => {
  const html = renderToStaticMarkup(createElement(InterviewForm, { copy: content.form, enabled: true, apiUrl: "https://api.example.com" }));
  assert.match(html, /method="post"/);
  assert.match(html, /action="https:\/\/api\.example\.com\/api\/v1\/public\/interview-requests"/);
  assert.match(html, /fieldset disabled/);
  assert.match(html, /<noscript>/);
});
