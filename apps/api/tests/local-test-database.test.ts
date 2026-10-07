import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedTestDatabaseUrl } from "./local-test-database.js";
test("fixture suites accept only an explicit isolated loopback careiq_test target", () => {
  assert.equal(isolatedTestDatabaseUrl({}), undefined);
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const value=`postgresql://operator:private-test-password@${host}:5432/careiq_test`;
    assert.equal(isolatedTestDatabaseUrl({ TEST_DATABASE_URL: value }), value);
  }
  for (const value of ["invalid private-test-password", "postgresql://operator:private-test-password@hosted.example/careiq_test", "postgresql://localhost/careiq_review", "postgresql://localhost/production", "postgresql://localhost/careiq_test?host=hosted.example", "postgresql://localhost/careiq_test#fragment", "https://localhost/careiq_test"]) {
    assert.throws(() => isolatedTestDatabaseUrl({ TEST_DATABASE_URL: value }), (error: unknown) => error instanceof Error && !error.message.includes("private-test-password"));
  }
});
