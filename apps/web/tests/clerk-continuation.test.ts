import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClerkContinuation } from "../src/lib/clerk-continuation";

test("same-route Clerk continuation retains every authentication override and cookie", () => {
  const response = new Response(null, { headers: {
    "x-middleware-rewrite": "http://localhost:3101/sign-in",
    "x-middleware-override-headers": "x-clerk-auth-status,x-clerk-auth-token",
    "x-middleware-request-x-clerk-auth-status": "signed-out",
    "x-middleware-request-x-clerk-auth-token": "",
    "set-cookie": "__clerk_db_jwt=; Path=/; HttpOnly; SameSite=Lax",
  } });
  const result = normalizeClerkContinuation(response, "http://localhost:3101/sign-in");
  assert.equal(result, response);
  assert.equal(result.headers.get("x-middleware-rewrite"), null);
  assert.equal(result.headers.get("x-middleware-next"), "1");
  assert.equal(result.headers.get("x-middleware-override-headers"), "x-clerk-auth-status,x-clerk-auth-token");
  assert.equal(result.headers.get("x-middleware-request-x-clerk-auth-status"), "signed-out");
  assert.equal(result.headers.get("x-middleware-request-x-clerk-auth-token"), "");
  assert.match(result.headers.get("set-cookie") || "", /HttpOnly/);
});
test("other Clerk destinations, redirects and refused responses remain unchanged", () => {
  for (const target of ["http://localhost:3101/session-tasks", "https://example.com/sign-in", "http://localhost:3101/sign-in?invitation=1"]) {
    const response = new Response(null, { headers: { "x-middleware-rewrite": target } });
    normalizeClerkContinuation(response, "http://localhost:3101/sign-in");
    assert.equal(response.headers.get("x-middleware-rewrite"), target);
    assert.equal(response.headers.get("x-middleware-next"), null);
  }
  for (const status of [307, 401, 403, 500]) {
    const response = new Response(null, { status, headers: { location: "https://example.com/handshake", "x-middleware-rewrite": "http://localhost:3101/sign-in" } });
    normalizeClerkContinuation(response, "http://localhost:3101/sign-in");
    assert.equal(response.status, status);
    assert.equal(response.headers.get("location"), "https://example.com/handshake");
    assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost:3101/sign-in");
    assert.equal(response.headers.get("x-middleware-next"), null);
  }
});
