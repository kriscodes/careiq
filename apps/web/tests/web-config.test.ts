import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import proxy, { config } from "../src/proxy";
import { apiRequestUrl, designPreviewEnabled, isDesignPreviewPath, validateProductionWebConfig } from "../src/lib/web-config";

test("a session token can be sent only to a configured HTTPS or loopback API", () => {
  for (const origin of ["https://api.careiq.invalid", "http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"]) assert.equal(apiRequestUrl(origin, "/api/v1/me"), `${origin}/api/v1/me`);
  for (const origin of [undefined, "http://api.careiq.invalid", "https://person:secret@api.careiq.invalid", "https://api.careiq.invalid?secret=1", "https://api.careiq.invalid/#secret", "file:///private/data", "javascript:alert(1)"]) assert.throws(() => apiRequestUrl(origin, "/api/v1/me"));
  for (const path of ["https://other.invalid/api/v1/me", "//other.invalid/api/v1/me", "/sign-in", "/api/v1/\\other.invalid"]) assert.throws(() => apiRequestUrl("https://api.careiq.invalid", path));
});
test("production configuration requires live mode and fails before contacting a provider", () => {
  const live = { NODE_ENV: "production", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_fixture", CLERK_SECRET_KEY: "sk_live_fixture", NEXT_PUBLIC_API_URL: "https://api.careiq.invalid" };
  assert.doesNotThrow(() => validateProductionWebConfig(live));
  for (const change of [{ CLERK_SECRET_KEY: undefined }, { NEXT_PUBLIC_API_URL: undefined }, { NEXT_PUBLIC_API_URL: "http://api.careiq.invalid" }, { NEXT_PUBLIC_API_URL: "http://localhost:3100" }, { NEXT_PUBLIC_API_URL: "https://127.0.0.1:3100" }, { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fixture" }, { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fixture", CLERK_SECRET_KEY: "sk_test_fixture" }]) assert.throws(() => validateProductionWebConfig({ ...live, ...change }));
  assert.doesNotThrow(() => validateProductionWebConfig({ NODE_ENV: "development" }));
});
test("the preview static files and page all match Proxy and are disabled in production", async () => {
  assert.equal(designPreviewEnabled("production"), false);
  assert.equal(designPreviewEnabled("development"), true);
  assert.equal(isDesignPreviewPath("/design-preview-other"), false);
  const environment = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    for (const path of ["/workflow-preview", "/workflow-preview/fixture.png", "/workflow%2Dpreview", "/design-preview", "/design-preview/index.html", "/design-preview/web-design-board.png", "/design-preview/ios-design-board.png", "/design-preview%2Findex.html", "/design%2Dpreview/index.html"]) {
      assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: path }), true);
      const response = await proxy(new NextRequest(`https://web.careiq.invalid${path}`), undefined as never);
      assert.equal(response?.status, 404);
      assert.equal(response?.headers.get("cache-control"), "no-store");
      assert.equal(response?.headers.get("x-robots-tag"), "noindex, nofollow");
    }
  } finally { if (environment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Reflect.set(process.env, "NODE_ENV", environment); }
});

test("only exact owner-supplied association files bypass auth, and missing setup stays 404", async () => {
  const original = process.cwd();
  const fixture = mkdtempSync(join(tmpdir(), "careiq-association-test-"));
  try {
    process.chdir(fixture);
    for (const name of ["apple-app-site-association", "assetlinks.json"]) {
      const request = new NextRequest(`https://web.careiq.invalid/.well-known/${name}`);
      assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: request.url }), true);
      assert.equal((await proxy(request, undefined as never))?.status, 404);
      mkdirSync(join(fixture, "public", ".well-known"), { recursive: true });
      writeFileSync(join(fixture, "public", ".well-known", name), JSON.stringify({ testFixture: true }));
      const response = await proxy(request, undefined as never);
      assert.equal(response?.headers.get("x-middleware-next"), "1");
      assert.equal(response?.headers.get("content-type"), "application/json");
      assert.equal(response?.headers.get("cache-control"), "public, max-age=3600");
    }
  } finally { process.chdir(original); rmSync(fixture, { recursive: true, force: true }); }
});
