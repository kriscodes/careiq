import assert from "node:assert/strict";
import test from "node:test";
import { readMobileConfiguration } from "../src/config";

test("missing environment supports an offline setup shell", () => {
  assert.deepEqual(readMobileConfiguration({}, false), {
    apiUrl: null,
    clerkPublishableKey: null,
    issues: [],
  });
});
test("only public origins are accepted and local HTTP is development only", () => {
  assert.equal(
    readMobileConfiguration({ apiUrl: "https://api.example.com/" }, false)
      .apiUrl,
    "https://api.example.com",
  );
  for (const origin of [
    "http://localhost:3000",
    "http://10.0.2.2:3000",
    "http://192.168.1.10:3000",
  ]) {
    assert.equal(
      readMobileConfiguration({ apiUrl: origin }, true).apiUrl,
      origin,
    );
    assert.equal(
      readMobileConfiguration({ apiUrl: origin }, false).apiUrl,
      null,
    );
  }
  for (const origin of [
    "http://api.example.com",
    "https://user:secret@example.com",
    "https://example.com/api/v1",
    "https://example.com?token=secret",
    "https://example.com/#secret",
    "file:///tmp/api",
  ]) {
    assert.equal(
      readMobileConfiguration({ apiUrl: origin }, true).apiUrl,
      null,
    );
  }
});
test("secret keys are rejected without echoing the value", () => {
  const result = readMobileConfiguration(
    { clerkPublishableKey: "sk_test_sensitive" },
    true,
  );
  assert.equal(result.clerkPublishableKey, null);
  assert.equal(JSON.stringify(result).includes("sensitive"), false);
});
