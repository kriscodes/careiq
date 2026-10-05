import assert from "node:assert/strict";
import test from "node:test";
import { resolveClinicalScope, type AccessContext } from "../src/lib/api/practice";
import { NO_CAPABILITIES } from "../src/lib/capabilities";

const location = "0192e0b8-2b33-7000-8000-000000000001";
const otherLocation = "0192e0b8-2b33-7000-8000-000000000002";
const context = (): AccessContext => ({
  userId: "synthetic-user",
  orgId: "synthetic-org",
  practice: { id: "synthetic-practice", name: "Synthetic practice", authorizationMode: "location", status: "active" },
  onboarding: "ready",
  enrollmentStatus: "active",
  capabilities: NO_CAPABILITIES,
  management: { locations: false, members: false },
  locations: [{ id: location, name: "Assigned location", timeZone: "UTC", status: "active" }],
});

test("location mode requires an explicit assigned selection, even for a practice owner", () => {
  const member = context();
  assert.deepEqual(resolveClinicalScope(member, location), { kind: "location", locationId: location });
  for (const selected of ["", otherLocation, "../patients", `${location}?all=true`]) {
    assert.deepEqual(resolveClinicalScope(member, selected), { kind: "blocked" });
  }
  const ownerWithoutAssignments = { ...member, management: { locations: true, members: true }, locations: [] };
  assert.deepEqual(resolveClinicalScope(ownerWithoutAssignments, location), { kind: "blocked" });
});

test("stale selections cannot reopen a removed assignment or another practice's location", () => {
  const firstPractice = context();
  assert.equal(resolveClinicalScope(firstPractice, location).kind, "location");
  const assignmentRemoved = { ...firstPractice, locations: [] };
  assert.deepEqual(resolveClinicalScope(assignmentRemoved, location), { kind: "blocked" });
  const nextPractice = { ...context(), orgId: "different-org", locations: [{ id: otherLocation, name: "Other location", timeZone: "UTC" }] };
  assert.deepEqual(resolveClinicalScope(nextPractice, location), { kind: "blocked" });
  assert.deepEqual(resolveClinicalScope(nextPractice, otherLocation), { kind: "location", locationId: otherLocation });
});

test("suspension, incomplete enrollment, and closed locations block clinical navigation", () => {
  for (const enrollmentStatus of [null, "invited", "accepted_unassigned", "pending", "suspended", "revoked"]) {
    assert.deepEqual(resolveClinicalScope({ ...context(), enrollmentStatus }, location), { kind: "blocked" });
  }
  for (const onboarding of ["required", "pending"] as const) {
    assert.deepEqual(resolveClinicalScope({ ...context(), onboarding }, location), { kind: "blocked" });
  }
  for (const status of ["suspended", "provisioning", "closed", "unknown"]) {
    const value = context();
    value.practice!.status = status;
    assert.deepEqual(resolveClinicalScope(value, location), { kind: "blocked" });
  }
  const closed = context();
  closed.locations[0].status = "closed";
  assert.deepEqual(resolveClinicalScope(closed, location), { kind: "blocked" });
});

test("missing or unknown practice context never falls back to legacy clinical routes", () => {
  assert.deepEqual(resolveClinicalScope({ ...context(), practice: null }, location), { kind: "blocked" });
  assert.deepEqual(resolveClinicalScope({ ...context(), orgId: null }, location), { kind: "blocked" });
  const unknown = context();
  // Simulate an unrecognized future server value crossing the JSON boundary.
  unknown.practice!.authorizationMode = "future-mode" as "location";
  assert.deepEqual(resolveClinicalScope(unknown, location), { kind: "blocked" });
});

test("explicit legacy mode remains usable only for an active ready practice", () => {
  const legacy = context();
  legacy.practice!.authorizationMode = "legacy";
  legacy.enrollmentStatus = null;
  legacy.locations = [];
  assert.deepEqual(resolveClinicalScope(legacy, ""), { kind: "legacy" });
  assert.deepEqual(resolveClinicalScope({ ...legacy, onboarding: "pending" }, ""), { kind: "blocked" });
  legacy.practice!.status = "suspended";
  assert.deepEqual(resolveClinicalScope(legacy, ""), { kind: "blocked" });
});

test("the server's assigned-location contract need not repeat location status", () => {
  const value = context();
  delete value.locations[0].status;
  assert.deepEqual(resolveClinicalScope(value, location), { kind: "location", locationId: location });
});
