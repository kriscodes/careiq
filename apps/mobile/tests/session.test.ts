import assert from "node:assert/strict";
import test from "node:test";
import { readAccessContext } from "../src/access-validation";
import { ApiError } from "../src/api";
const identity = { userId: "user_fixture", orgId: "org_fixture", sessionId: "sess_fixture" };
const context = {
  ...identity, practice: { id: "practice_fixture", name: "Fixture practice", authorizationMode: "location", status: "active", ownerUserId: "user_fixture" },
  onboarding: "ready", enrollmentStatus: "active", capabilities: { patients: { read: false, create: false }, appointments: { read: false, create: false } },
  management: { locations: true, members: true }, locations: [],
};
test("a fresh access response must identify the current account, session and practice", () => {
  assert.equal(readAccessContext(context, identity), context);
  for (const change of [{ userId: "user_other" }, { orgId: "org_other" }, { sessionId: "sess_other" }]) {
    assert.throws(() => readAccessContext({ ...context, ...change }, identity), (error: unknown) => error instanceof ApiError && error.code === "INVALID_ACCESS_RESPONSE");
  }
});
test("incomplete or malformed access responses cannot reopen protected screens", () => {
  for (const value of [null, {}, { ...context, locations: null }, { ...context, management: { members: "true" } }, { ...context, capabilities: {} }, { ...context, practice: { ...context.practice, name: null } }, { ...context, locations: [{ id: "a" }] }]) {
    assert.throws(() => readAccessContext(value, identity), ApiError);
  }
});
test("an authenticated account without an organization or enrollment remains valid but grants no location access", () => {
  const account = { ...context, orgId: null, practice: null, onboarding: "required", enrollmentStatus: null, management: { locations: false, members: false } };
  assert.equal(readAccessContext(account, { ...identity, orgId: null }).locations.length, 0);
});
