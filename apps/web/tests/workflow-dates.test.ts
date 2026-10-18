import test from "node:test";
import assert from "node:assert/strict";
import { instantFromLocal } from "../src/lib/workflow-dates";
test("appointment time uses the location zone instead of the browser zone", () => { assert.equal(instantFromLocal("2026-10-16T09:30", "America/Los_Angeles"), "2026-10-16T16:30:00.000Z"); assert.equal(instantFromLocal("2026-01-16T09:30", "America/Los_Angeles"), "2026-01-16T17:30:00.000Z"); });
test("daylight saving gaps and repeated hours cannot silently move a booking", () => { assert.throws(() => instantFromLocal("2026-03-08T02:30", "America/New_York"), /does not exist/); assert.throws(() => instantFromLocal("2026-11-01T01:30", "America/New_York"), /occurs twice/); assert.equal(instantFromLocal("2026-11-01T02:30", "America/New_York"), "2026-11-01T07:30:00.000Z"); });
