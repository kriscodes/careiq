import { test } from "node:test";
import assert from "node:assert/strict";
import { isUuid, parseScheduledAt } from "../src/validation.js";

test("invalid patient IDs are rejected before database access", () => {
  for (const id of [undefined, null, 12, "", "not-a-uuid"]) assert.equal(isUuid(id), false);
  assert.equal(isUuid("01a0607e-1317-7807-9b5c-7fe97484662b"), true);
});
test("appointment times require an explicit timezone and valid date", () => {
  for (const date of [null, "garbage", "2026-09-22", "2026-09-22T10:00", "2026-02-30T10:00:00Z"]) assert.equal(parseScheduledAt(date), null);
  assert.equal(parseScheduledAt("2026-09-22T10:00:00-07:00")?.toISOString(), "2026-09-22T17:00:00.000Z");
});
