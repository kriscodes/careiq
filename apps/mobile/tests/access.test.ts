import assert from "node:assert/strict";
import test from "node:test";
import { canEnterLocation, draftErrors, onboardingPayload, type AccessContext, type Draft } from "../src/contracts";
const draft: Draft = {
  practiceName: " Marlow Family Practice ",
  locationName: " Main location ",
  timeZone: "America/Los_Angeles",
  address: "  ",
  step: 3
};
test("onboarding submission normalizes only the public practice fields and remains stable after draft edits", () => {
  const submitted = onboardingPayload(draft);
  const changed = {
    ...draft,
    practiceName: "Different practice"
  };
  assert.deepEqual(submitted, {
    name: "Marlow Family Practice",
    location: {
      name: "Main location",
      timeZone: "America/Los_Angeles"
    }
  });
  assert.notDeepEqual(submitted, onboardingPayload(changed));
  assert.equal("step" in submitted, false);
});
test("draft validation matches API limits and rejects invalid time zones", () => {
  assert.deepEqual(draftErrors(draft), {});
  assert.ok(draftErrors({
    ...draft,
    practiceName: "a".repeat(121)
  }).practiceName);
  assert.ok(draftErrors({
    ...draft,
    locationName: "a".repeat(121)
  }).locationName);
  assert.ok(draftErrors({
    ...draft,
    address: "a".repeat(501)
  }).address);
  assert.ok(draftErrors({
    ...draft,
    timeZone: "Somewhere/Unknown"
  }).timeZone);
});
const access: AccessContext = {
  userId: "user_a",
  sessionId: "session_a",
  orgId: "org_a",
  practice: {
    id: "practice_a",
    name: "A",
    ownerUserId: "user_a",
    status: "active",
    authorizationMode: "location"
  },
  onboarding: "ready",
  enrollmentStatus: "active",
  capabilities: {
    patients: {
      read: true,
      create: true
    },
    appointments: {
      read: true,
      create: true
    }
  },
  management: {
    locations: true,
    members: true
  },
  locations: [{
    id: "location_a",
    name: "A",
    address: null,
    timeZone: "UTC",
    status: "active"
  }]
};
test("a verified owner still needs an explicitly assigned active location", () => {
  assert.equal(canEnterLocation(access, "location_a"), true);
  assert.equal(canEnterLocation({
    ...access,
    locations: []
  }, "location_a"), false);
  assert.equal(canEnterLocation(access, "location_b"), false);
});
test("pending, removed, inactive and disabled contexts cannot enter a location", () => {
  for (const enrollmentStatus of ["pending_assignment", "suspended", "revoked", null]) assert.equal(canEnterLocation({
    ...access,
    enrollmentStatus
  }, "location_a"), false);
  assert.equal(canEnterLocation({
    ...access,
    onboarding: "pending"
  }, "location_a"), false);
  assert.equal(canEnterLocation({
    ...access,
    practice: {
      ...access.practice!,
      status: "inactive"
    }
  }, "location_a"), false);
  assert.equal(canEnterLocation({
    ...access,
    locations: [{
      ...access.locations[0],
      status: "inactive"
    }]
  }, "location_a"), false);
});
