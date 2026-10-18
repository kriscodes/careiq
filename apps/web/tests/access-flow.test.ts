import assert from "node:assert/strict";
import test from "node:test";
import { invitationEmailMatches, onboardingInput, onboardingView, safeDestination, signInStep, validateDraft, type OnboardingState } from "../src/lib/access-flow";

const base: OnboardingState = { eligible: true, emailVerified: true, draft: null, operation: null };
test("restored destinations cannot redirect to external or privileged routes", () => {
  for (const attack of ["//evil.example", "https://evil.example", "\\\\evil.example", "/session-tasks", "/?token=secret", "/%2f%2fevil.example", "/?manage=owneraccess"]) assert.equal(safeDestination(attack), "/");
  assert.equal(safeDestination("/?invitations=1"), "/?invitations=1");
});
test("sign-in never finalizes incomplete MFA, device-trust, or protect challenges", () => {
  assert.equal(signInStep("complete"), "complete");
  assert.equal(signInStep("needs_second_factor", [{ strategy: "totp" }]), "mfa");
  assert.equal(signInStep("needs_client_trust", [{ strategy: "email_code" }]), "provider");
  assert.equal(signInStep("needs_protect_check"), "provider");
  assert.equal(signInStep("needs_first_factor"), "provider");
  assert.equal(signInStep("needs_new_password"), "reset");
});
test("a different invited email cannot pass the account gate", () => {
  assert.equal(invitationEmailMatches(["alex@practice.example"], "sam@practice.example"), false);
  assert.equal(invitationEmailMatches(["SAM@practice.example"], " sam@practice.example "), true);
  assert.equal(invitationEmailMatches([], "sam@practice.example"), false);
});
test("submitted setup resumes ahead of eligibility or editable draft screens", () => {
  assert.equal(onboardingView(base), "draft");
  assert.equal(onboardingView({ ...base, eligible: false }), "restricted");
  assert.equal(onboardingView({ ...base, emailVerified: false }), "verify");
  assert.equal(onboardingView({ ...base, eligible: false, operation: { state: "pending", organizationId: null, practiceId: null } }), "pending");
  assert.equal(onboardingView({ ...base, emailVerified: false, operation: { state: "complete", organizationId: "org-existing", practiceId: "practice-existing" } }), "complete");
});
test("practice creation has only required existing data and normalizes retry details", () => {
  const draft = { practiceName: "  Marlow  ", locationName: " Main office ", timeZone: "America/Los_Angeles", address: "  ", step: 3 as const };
  assert.equal(validateDraft(draft, true), null);
  assert.deepEqual(onboardingInput(draft), { name: "Marlow", location: { name: "Main office", timeZone: "America/Los_Angeles" } });
  assert.match(validateDraft({ ...draft, locationName: " " }, true)!, /location name/);
  assert.match(validateDraft({ ...draft, timeZone: "Unknown/Zone" }, true)!, /valid time zone/);
  assert.equal(validateDraft({ ...draft, practiceName: "", locationName: "", step: 1 }), null);
});
