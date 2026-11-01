import assert from "node:assert/strict";
import { test } from "node:test";
import { practiceDateKey, visitReadinessTone } from "../src/lib/today-operations";
import type { WorkflowAppointment } from "../src/lib/api/workflow";

test("Today follows the practice date across UTC midnight and opposite local days", () => {
  const now = new Date("2026-11-01T02:30:00Z");
  assert.equal(practiceDateKey(now, "America/Los_Angeles"), "2026-10-31");
  assert.equal(practiceDateKey(now, "Asia/Tokyo"), "2026-11-01");
  assert.equal(practiceDateKey(new Date("2026-11-01T07:00:00Z"), "America/Los_Angeles"), "2026-11-01");
});

test("Today remains the same civil day through the repeated daylight-saving hour", () => {
  assert.equal(practiceDateKey(new Date("2026-11-01T08:30:00Z"), "America/Los_Angeles"), "2026-11-01");
  assert.equal(practiceDateKey(new Date("2026-11-01T09:30:00Z"), "America/Los_Angeles"), "2026-11-01");
});

test("missing readiness remains unknown and cannot be counted as paperwork ready", () => {
  const visit = { id: "a", patientId: "p", scheduledAt: "2026-11-01T18:00:00Z", status: "confirmed", reason: null } satisfies WorkflowAppointment;
  assert.equal(visitReadinessTone(visit), "unknown");
  assert.equal(visitReadinessTone({ ...visit, readiness: { state: "unknown" } }), "unknown");
  assert.equal(visitReadinessTone({ ...visit, readiness: { state: "unknown", missingCount: 1 } }), "attention");
  assert.equal(visitReadinessTone({ ...visit, readiness: { state: "not_required" } }), "ready");
});
