import assert from "node:assert/strict";
import test from "node:test";
import { AccessActionError, authErrorMessage, isUnknownAccountError } from "../src/lib/auth-errors";
import { availableTimeZones } from "../src/lib/access-flow";

test("provider diagnostics and unknown exceptions never become account-page copy", () => {
  for (const error of [new Error("sk_live_secret provider stack"), { code: "unknown", message: "database secret", longMessage: "internal trace" }, { errors: [{ code: "unknown", message: "token=secret" }] }]) assert.doesNotMatch(authErrorMessage(error), /secret|stack|token|trace/);
  assert.equal(authErrorMessage(new AccessActionError("The passwords don’t match. Try again.")), "The passwords don’t match. Try again.");
});
test("credential errors do not identify whether an account exists, including wrapped provider errors", () => {
  const missing = { cause: { errors: [{ code: "form_identifier_not_found" }] } };
  assert.equal(authErrorMessage(missing), authErrorMessage({ code: "form_password_incorrect" }));
  assert.equal(isUnknownAccountError(missing), true);
  assert.equal(isUnknownAccountError({ code: "network_error" }), false);
  assert.match(authErrorMessage({ code: "too_many_requests" }), /Wait/);
});
test("a browser without an exhaustive Intl time-zone list can still complete setup", t => {
  t.mock.method(Intl, "supportedValuesOf", () => { throw new RangeError("not supported"); });
  const zones = availableTimeZones("Europe/London");
  assert.ok(zones.includes("Europe/London"));
  assert.ok(zones.includes("UTC"));
  assert.ok(zones.includes("America/Los_Angeles"));
});
