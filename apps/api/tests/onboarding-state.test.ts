import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApiApp, type ApiDependencies } from "../src/app.js";
import { AccessError } from "../src/services/practice-policy.js";
import { approvedFounder, parseOnboardingDraft } from "../src/services/onboarding-draft.js";
import type { RequestAuthentication } from "../src/middleware/tenant-context.js";

const draft = { practiceName: "", locationName: "", timeZone: "America/Los_Angeles", address: "", step: 1 as const };

test("drafts accept unfinished nonclinical setup and reject credentials, hidden data and invalid fields", () => {
  assert.deepEqual(parseOnboardingDraft(draft), draft);
  assert.deepEqual(parseOnboardingDraft({ ...draft, timeZone: "", step: 2 }), { ...draft, timeZone: "", step: 2 });
  for (const input of [
    { ...draft, password: "never-store" }, { ...draft, token: "never-store" }, { ...draft, mfaCode: "123456" },
    { ...draft, actorUserId: "forged" }, { ...draft, practiceName: "x".repeat(121) }, { ...draft, locationName: "x".repeat(121) },
    { ...draft, address: "x".repeat(501) }, { ...draft, address: "hidden\u0000text" }, { ...draft, timeZone: "not/a-zone" },
    { ...draft, step: 4 }, { ...draft, step: "1" }, { practiceName: "Partial" },
  ]) assert.throws(() => parseOnboardingDraft(input), AccessError);
  assert.equal(approvedFounder("user_allowed", {}), false);
  assert.equal(approvedFounder("user_allowed", { CAREIQ_PRACTICE_CREATOR_USER_IDS: " user_allowed, user_other " }), true);
  assert.equal(approvedFounder("user", { CAREIQ_PRACTICE_CREATOR_USER_IDS: "user_allowed" }), false);
});

async function withOnboardingApi(auth: RequestAuthentication, run: (base: string, calls: string[]) => Promise<void>, stateFailure?: AccessError) {
  const calls: string[] = [];
  const actor = () => { if (!auth.isAuthenticated || !auth.userId) throw new AccessError("UNAUTHENTICATED", 401); };
  const app = createApiApp({
    authenticate: (_req, _res, next) => next(), getAuth: () => auth, health: async () => true,
    findPracticeByClerkOrgId: async () => { calls.push("findPractice"); return null; },
    listPatients: async () => [], listAppointments: async () => [], createPatient: async () => null, createAppointment: async () => null,
    practiceAccess: {
      getOnboardingState: async () => { actor(); if (stateFailure) throw stateFailure; calls.push("state"); return { eligible: true, emailVerified: true, draft, operation: null }; },
      saveOnboardingDraft: async (_auth, body) => { actor(); const value = parseOnboardingDraft(body); calls.push("save"); return value; },
      onboard: async () => { actor(); calls.push("onboard"); return {}; },
    } as NonNullable<ApiDependencies["practiceAccess"]>,
  }, { origins: ["https://careiq.example"], trustedProxies: false, interviews: { enabled: false, store: async () => {}, log: () => {} } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("onboarding state is a no-store read and never provisions/selects a practice", async () => {
  await withOnboardingApi({ isAuthenticated: true, userId: "user_allowed", orgId: null }, async (base, calls) => {
    const response = await fetch(`${base}/api/v1/onboarding/state`);
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { data: { eligible: true, emailVerified: true, draft, operation: null } });
    assert.deepEqual(calls, ["state"]);
    const saved = await fetch(`${base}/api/v1/onboarding/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { data: draft });
    assert.deepEqual(calls, ["state", "save"]);
    assert.equal((await fetch(`${base}/api/v1/onboarding`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Demo" }) })).status, 400);
    assert.deepEqual(calls, ["state", "save"]);
  });
});

test("onboarding HTTP routes reject missing authentication and malformed draft bodies", async () => {
  await withOnboardingApi({ isAuthenticated: false }, async (base, calls) => {
    const state = await fetch(`${base}/api/v1/onboarding/state`);
    assert.equal(state.status, 401); assert.deepEqual(await state.json(), { error: { code: "UNAUTHENTICATED", message: "Sign in again to continue." } });
    const saved = await fetch(`${base}/api/v1/onboarding/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    assert.equal(saved.status, 401); assert.deepEqual(await saved.json(), { error: { code: "UNAUTHENTICATED", message: "Sign in again to continue." } });
    assert.deepEqual(calls, []);
  });
  await withOnboardingApi({ isAuthenticated: true, userId: "user_allowed" }, async (base, calls) => {
    for (const [input, code, message] of [
      [null, "INVALID_REQUEST", "Request body must be valid JSON."],
      [[], "INVALID_REQUEST", "Check your practice setup details and try again."],
      [{ ...draft, password: "never-store" }, "INVALID_ONBOARDING_DRAFT", "Check the practice setup fields and their lengths."],
      [{ ...draft, timeZone: "invalid/zone" }, "INVALID_TIME_ZONE", "Choose a valid time zone."],
      [{ ...draft, step: 4 }, "INVALID_ONBOARDING_STEP", "Choose a valid setup step and try again."],
    ]) {
      const response = await fetch(`${base}/api/v1/onboarding/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: { code, message } });
    }
    assert.deepEqual(calls, []);
  });
  for (const [code, status, message] of [
    ["AUTHORIZATION_UNAVAILABLE", 503, "We couldn’t verify your account. Please try again."],
    ["ACCOUNT_UNAVAILABLE", 403, "This account is unavailable. Use another account or contact support."],
    ["VERIFIED_EMAIL_REQUIRED", 403, "Verify your email address before setting up a practice."],
    ["ONBOARDING_NOT_ELIGIBLE", 403, "This account has not been approved to create a practice."],
    ["ONBOARDING_IN_PROGRESS", 409, "Practice setup was already submitted. Resume the original setup."],
    ["ONBOARDING_ALREADY_COMPLETE", 409, "Your practice is already created. Open it to continue."],
  ] as const) {
    await withOnboardingApi({ isAuthenticated: true, userId: "user_allowed" }, async (base) => {
      const response = await fetch(`${base}/api/v1/onboarding/state`);
      assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: { code, message } });
    }, new AccessError(code, status, "Sensitive provider or database diagnostics"));
  }
});
