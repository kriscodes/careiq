import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMigrationLedger, assertMigrationTarget, migrationManifest } from "../src/db/migration-safety.js";
test("release manifest and migration ledger detect drift, missing history and changed order", async () => {
  const entries = await migrationManifest();
  assert.equal(entries.length, 19);
  const ledger = entries.map((entry) => ({ created_at: String(entry.when), hash: entry.hash }));
  assertMigrationLedger(entries, []);
  assertMigrationLedger(entries, ledger, true);
  assertMigrationLedger(entries, ledger.slice(0, 18));
  assert.throws(() => assertMigrationLedger(entries, ledger.slice(0, 18), true));
  assert.throws(() => assertMigrationLedger(entries, [{ ...ledger[0]!, hash: "changed" }]));
  assert.throws(() => assertMigrationLedger(entries, [ledger[1]!, ledger[0]!]));
  assert.throws(() => assertMigrationLedger(entries, [...ledger, ledger[0]!]));
});
test("non-loopback migration targets require an exact explicit database confirmation", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) assertMigrationTarget(`postgresql://operator:private@${host}/careiq_test`, "careiq_test");
  assertMigrationTarget("postgresql://operator:private@hosted.example/careiq", "careiq", "careiq");
  for (const confirmation of [undefined, "other"]) assert.throws(() => assertMigrationTarget("postgresql://operator:private@hosted.example/careiq", "careiq", confirmation), (error: unknown) => error instanceof Error && !error.message.includes("private"));
  assert.throws(() => assertMigrationTarget("postgresql://operator:private@localhost/careiq_test", "other"));
  assert.throws(() => assertMigrationTarget("http://localhost/careiq_test", "careiq_test"));
});
