import { test } from "node:test";
import assert from "node:assert/strict";
import { interviewRequestsEnabled, parseCorsOrigins, parseTrustedProxies } from "../src/public-config.js";

test("CORS includes local apps and normalizes exact configured origins", () => {
  assert.deepEqual(parseCorsOrigins({}), ["http://localhost:3001", "http://localhost:3002"]);
  assert.deepEqual(parseCorsOrigins({ NODE_ENV: "production", CORS_ORIGINS: " https://careiqlabs.com///,https://app.example.com/,https://careiqlabs.com" }), ["https://careiqlabs.com", "https://app.example.com"]);
  for (const value of ["*", "https://*.careiqlabs.com", "http://*", "null", "https://example.com/path", "https://u:p@example.com", "https://example.com?x=1", "ftp://example.com", "https://example.com,"]) {
    assert.throws(() => parseCorsOrigins({ CORS_ORIGINS: value }));
  }
  assert.throws(() => parseCorsOrigins({ NODE_ENV: "production" }));
});

test("proxy trust is disabled unless explicit narrow addresses are configured", () => {
  assert.equal(parseTrustedProxies(""), false);
  assert.deepEqual(parseTrustedProxies("127.0.0.1, 10.42.0.0/16, ::1/128"), ["127.0.0.1", "10.42.0.0/16", "::1/128"]);
  for (const value of ["true", "1", "loopback", "0.0.0.0/0", "::/0", "0.0.0.0", "::", "10.0.0.0/8", "127.0.0.1/33", "127.0.0.1/-1", "bad", "127.0.0.1,"]) {
    assert.throws(() => parseTrustedProxies(value));
  }
});

test("submission is disabled by default and requires explicit true", () => {
  assert.equal(interviewRequestsEnabled(""), false);
  assert.equal(interviewRequestsEnabled("false"), false);
  assert.equal(interviewRequestsEnabled("true"), true);
  assert.throws(() => interviewRequestsEnabled("yes"));
});
