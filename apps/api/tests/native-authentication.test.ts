import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { request } from "node:http";
import express from "express";
import { getAuth } from "@clerk/express";
import { createAuthenticationMiddleware } from "../src/middleware/authentication.js";
import { parseClerkAuthenticationPolicy } from "../src/public-config.js";

const origin = "https://careiq.example";
const nativeOrigin = "https://native.careiq.example";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwtKey = publicKey.export({ type: "spki", format: "pem" }).toString();
function token(azp?: string, expires = 60, claims: Record<string, unknown> = {}, headerClaims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "synthetic", ...headerClaims })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user_synthetic", sid: "sess_synthetic", iss: "https://clerk.example", ...(azp === undefined ? {} : { azp }), iat: now - 1, nbf: now - 2, exp: now + expires, ...claims })).toString("base64url");
  const data = `${header}.${payload}`;
  return `${data}.${sign("RSA-SHA256", Buffer.from(data), privateKey).toString("base64url")}`;
}
async function withAuth(nativeEnabled: boolean, run: (base: string) => Promise<void>) {
  const app = express();
  app.use(createAuthenticationMiddleware({ browserOrigins: [origin], nativeEnabled, nativeAuthorizedParties: [nativeOrigin] }, {
    publishableKey: `pk_test_${Buffer.from("clerk.example$").toString("base64")}`, secretKey: "sk_test_synthetic_only", jwtKey,
  }));
  app.get("/protected", (req, res) => { const auth = getAuth(req); res.status(auth.isAuthenticated ? 200 : 401).json({ authenticated: auth.isAuthenticated, orgId: auth.orgId, orgRole: auth.orgRole }); });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}
// Native transport has no browser fetch metadata. node.fetch adds Sec-Fetch-Mode,
// so use HTTP directly and specify browser metadata only in those test cases.
const nativeRequest = (base: string, jwt: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  const req = request(`${base}/protected`, { headers: { Authorization: `Bearer ${jwt}`, ...headers } }, (response) => {
    let body = ""; response.setEncoding("utf8"); response.on("data", (chunk) => { body += chunk; });
    response.on("end", () => resolve({ status: response.statusCode!, body }));
  }); req.on("error", reject); req.end();
});
const status = async (base: string, jwt: string, headers: Record<string, string> = {}) => (await nativeRequest(base, jwt, headers)).status;

test("native authentication requires an explicit opt-in and never broadens browser origins", () => {
  const browser = parseClerkAuthenticationPolicy({ CORS_ORIGINS: origin });
  assert.deepEqual(browser, { browserOrigins: [origin], nativeEnabled: false, nativeAuthorizedParties: [] });
  assert.deepEqual(parseClerkAuthenticationPolicy({ CORS_ORIGINS: origin, CLERK_NATIVE_AUTH_ENABLED: "true", CLERK_NATIVE_AUTHORIZED_PARTIES: nativeOrigin }), { browserOrigins: [origin], nativeEnabled: true, nativeAuthorizedParties: [nativeOrigin] });
  assert.throws(() => parseClerkAuthenticationPolicy({ CLERK_NATIVE_AUTH_ENABLED: "yes" }));
  assert.throws(() => parseClerkAuthenticationPolicy({ CLERK_NATIVE_AUTHORIZED_PARTIES: nativeOrigin }));
  for (const party of ["*", "null", "https://*.example", "https://native.example/callback", "careiq://callback"]) {
    assert.throws(() => parseClerkAuthenticationPolicy({ CLERK_NATIVE_AUTH_ENABLED: "true", CLERK_NATIVE_AUTHORIZED_PARTIES: party }));
  }
});

test("disabled native gate rejects signed no-azp tokens while authorized browsers remain usable", async () => {
  await withAuth(false, async (base) => {
    assert.equal(await status(base, token(origin)), 200);
    assert.equal(await status(base, token()), 401);
    assert.equal(await status(base, token(nativeOrigin)), 401);
  });
});

test("native branch verifies signatures/expiry and rejects unknown azp, cookies and browser origins", async () => {
  await withAuth(true, async (base) => {
    assert.equal(await status(base, token()), 200);
    assert.equal(await status(base, token(nativeOrigin)), 200);
    assert.equal(await status(base, token("https://untrusted.example")), 401);
    assert.equal(await status(base, token(), { Origin: origin }), 401);
    assert.equal(await status(base, token(), { Cookie: "unrelated=value" }), 401);
    assert.equal(await status(base, token(), { Referer: origin }), 401);
    for (const header of ["Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest", "Sec-Fetch-User"]) assert.equal(await status(base, token(), { [header]: "same-origin" }), 401);
    assert.equal(await status(base, token(nativeOrigin), { Origin: origin }), 401);
    assert.equal(await status(base, token(origin), { Origin: origin }), 200);
    assert.equal(await status(base, token(undefined, -60)), 401);
    const parts = token().split("."); parts[2] = Buffer.alloc(256).toString("base64url");
    assert.equal(await status(base, parts.join(".")), 401);
  });
});

test("all session transports require the configured issuer and session claims", async () => {
  for (const native of [false, true]) await withAuth(native, async (base) => {
    for (const claims of [{ iss: "https://other-clerk.example" }, { iss: undefined }, { sid: undefined }, { sid: "" }, { sub: undefined }, { sub: "service_synthetic" }, { nbf: Math.floor(Date.now()/1000) + 60 }, { iat: Math.floor(Date.now()/1000) + 60 }, { sts: "pending", v: 2 }]) {
      assert.equal(await status(base, token(origin, 60, claims)), 401);
      if (native) assert.equal(await status(base, token(undefined, 60, claims)), 401);
    }
    assert.equal(await status(base, token(origin, 60, {}, { cat: "cl_B7d4PD333AAA" })), 401);
    assert.equal(await status(base, token(origin, 60, {}, { alg: "none" })), 401);
  });
});

test("version 2 native session organization claims are decoded by the installed SDK", async () => {
  await withAuth(true, async (base) => {
    const response = await nativeRequest(base, token(undefined, 60, { v: 2, o: { id: "org_synthetic", rol: "admin", slg: "synthetic" } }));
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { authenticated: true, orgId: "org_synthetic", orgRole: "org:admin" });
  });
});
