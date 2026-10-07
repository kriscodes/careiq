import assert from "node:assert/strict";
import test from "node:test";
import { authenticationDestination, invitationConfirmation } from "../src/invitation-policy";
test("invitation confirmation survives a remount only for the matching active organization", () => {
  assert.equal(invitationConfirmation("org_invited", "org_invited"), "confirm");
  assert.equal(invitationConfirmation("org_invited", "org_other"), "wrong-practice");
  assert.equal(invitationConfirmation("org_invited", null), "wrong-practice");
  assert.equal(invitationConfirmation(undefined, "org_invited"), "none");
  for (const value of ["1", "https://evil.example", "org_a?confirm=1", ["org_invited", "org_other"]]) {
    assert.equal(invitationConfirmation(value, "org_invited"), "wrong-practice");
  }
});
test("authentication preserves the invitation screen without replaying arbitrary redirects or confirmation parameters", () => {
  assert.equal(authenticationDestination("/join"), "/join");
  for (const value of [undefined, "https://evil.example", "//evil.example", "/join?confirm=org_other", "/onboarding", ["/join"]]) assert.equal(authenticationDestination(value), "/");
});
