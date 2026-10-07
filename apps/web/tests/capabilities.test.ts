import assert from "node:assert/strict";
import test from "node:test";
import { NO_CAPABILITIES, practiceCapabilities } from "../src/lib/capabilities";

test("only explicit server permissions enable creation", () => {
  assert.deepEqual(practiceCapabilities(undefined), NO_CAPABILITIES);
  assert.deepEqual(practiceCapabilities({ patients: { read: true, create: "true" } }), {
    patients: { read: true, create: false }, appointments: { read: false, create: false },
  });
  const member = { patients: { read: true, create: false }, appointments: { read: true, create: false } };
  assert.deepEqual(practiceCapabilities(member), member);
  const admin = { patients: { read: true, create: true }, appointments: { read: true, create: true } };
  assert.deepEqual(practiceCapabilities(admin), admin);
});

test("a newly resolved practice does not inherit the previous practice's grants", () => {
  const first = practiceCapabilities({ patients: { read: true, create: true }, appointments: { read: true, create: true } });
  const second = practiceCapabilities({ patients: { read: true, create: false }, appointments: { read: true, create: false } });
  assert.equal(first.patients.create, true);
  assert.equal(second.patients.create, false);
  assert.equal(second.appointments.create, false);
  assert.deepEqual(practiceCapabilities(null), NO_CAPABILITIES);
});
