import assert from "node:assert/strict";
import test from "node:test";
import { AccessLifecycle, canReviseSubmission, isForeground } from "../src/access-policy";
import { ApiError } from "../src/api";
test("background immediately cancels private work and blocks rendering until a fresh check completes", () => {
  const lifecycle = new AccessLifecycle("ready");
  assert.equal(lifecycle.hasFreshAccess, false);
  const controller = new AbortController();
  lifecycle.register(controller);
  lifecycle.suspend();
  assert.equal(controller.signal.aborted, true);
  assert.equal(lifecycle.snapshot(), "background:1");
  const backgroundWork = new AbortController();
  lifecycle.register(backgroundWork);
  assert.equal(backgroundWork.signal.aborted, true);
  const generation = lifecycle.beginCheck();
  assert.equal(lifecycle.snapshot(), "checking:2");
  assert.equal(lifecycle.completeCheck(generation), true);
  assert.equal(lifecycle.snapshot(), "ready:2");
  assert.equal(lifecycle.hasFreshAccess, true);
});
test("an access check from before a new background transition can never reopen private content", () => {
  const lifecycle = new AccessLifecycle("checking");
  lifecycle.withoutAuthentication();
  assert.equal(lifecycle.hasFreshAccess, false);
  const first = lifecycle.beginCheck();
  lifecycle.suspend();
  assert.equal(lifecycle.completeCheck(first), false);
  assert.equal(lifecycle.snapshot(), "background:3");
  const second = lifecycle.beginCheck();
  assert.equal(lifecycle.failCheck(second), true);
  assert.equal(lifecycle.snapshot(), "error:4");
  assert.equal(lifecycle.completeCheck(second), false);
});
test("OS inactive and background states are both treated as hidden", () => {
  assert.equal(isForeground("active"), true);
  for (const state of ["inactive", "background", "unknown", "extension"]) assert.equal(isForeground(state), false);
});
test("only definitive refusals before provisioning unlock submitted practice details", () => {
  assert.equal(canReviseSubmission(new ApiError("ONBOARDING_NOT_ELIGIBLE", 403, "Not eligible")), true);
  assert.equal(canReviseSubmission(new ApiError("INVALID_TIME_ZONE", 400, "Invalid")), true);
  for (const [code, status] of [["PROVISIONING_PENDING", 503], ["PROVISIONING_CONFLICT", 409], ["ONBOARDING_RETRY_CONFLICT", 409], ["REQUEST_TIMEOUT", 408], ["UNAUTHENTICATED", 401], ["UNKNOWN_FAILURE", 403]] as const) assert.equal(canReviseSubmission(new ApiError(code, status, code)), false);
  assert.equal(canReviseSubmission(new Error("Network unavailable")), false);
});

test("only the newest overlapping access check may restore protected content", () => {
  const lifecycle = new AccessLifecycle("ready");
  const first = lifecycle.beginCheck();
  const request = new AbortController();
  lifecycle.register(request);
  const second = lifecycle.beginCheck();
  assert.equal(request.signal.aborted, true);
  assert.equal(lifecycle.completeCheck(first), false);
  assert.equal(lifecycle.failCheck(first), false);
  assert.equal(lifecycle.hasFreshAccess, false);
  assert.equal(lifecycle.completeCheck(second), true);
});
test("sign-out invalidates an outstanding foreground check", () => {
  const lifecycle = new AccessLifecycle("checking");
  const attempt = lifecycle.beginCheck();
  const request = new AbortController();
  lifecycle.register(request);
  lifecycle.withoutAuthentication();
  assert.equal(request.signal.aborted, true);
  assert.equal(lifecycle.completeCheck(attempt), false);
  assert.equal(lifecycle.hasFreshAccess, false);
});
