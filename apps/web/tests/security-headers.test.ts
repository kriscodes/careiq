import assert from "node:assert/strict";
import test from "node:test";
import config from "../next.config";

test("all web paths reject framing without restricting Clerk script or connection origins", async () => {
  const rules = await config.headers!();
  assert.equal(rules[0].source, "/:path*");
  const headers = Object.fromEntries(rules[0].headers.map(header => [header.key.toLowerCase(), header.value]));
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.doesNotMatch(headers["content-security-policy"], /(?:default|script|connect)-src/);
});
