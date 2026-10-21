import assert from "node:assert/strict";
import test from "node:test";
import { AccessActionError, authErrorMessage, isUnknownAccountError } from "../src/lib/auth-errors";
import { translate } from "../../../packages/i18n";
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

test("the observed verification-code rate limit uses localized wait copy without provider details or an invented duration", () => {
  const error = { errors: [{ code: "verification_code_rate_limit_exceeded", message: "private provider secret" }], status: 429 };
  for (const locale of ["en", "es"] as const) {
    const t = (key: string) => translate(locale, key);
    const message = authErrorMessage(error, t);
    assert.equal(message, t("access.auth.tooManyAttempts"));
    assert.doesNotMatch(message, /secret|429|\d/);
  }
});
