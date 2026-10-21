import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_PROVIDERS, authProviderRedirects, configuredAuthProviders } from "../src/lib/auth-providers";

test("social provider buttons require an explicit reviewed allowlist", () => {
  assert.deepEqual(configuredAuthProviders(undefined), []);
  assert.deepEqual(configuredAuthProviders(""), []);
  assert.deepEqual(configuredAuthProviders("unknown,__proto__,constructor,googlex"), []);
  assert.deepEqual(configuredAuthProviders(" GOOGLE, apple,google, microsoft, ,unknown"), ["google", "apple", "microsoft"]);
  assert.equal(AUTH_PROVIDERS.google.strategy, "oauth_google");
});

test("OAuth returns through required account tasks and the existing mode-specific callback", () => {
  for (const mode of ["signin", "signup"] as const) {
    const destination = "/patient-paperwork?item=019aaaaa-1234-7123-8123-123456789abc";
    const redirects = authProviderRedirects(mode, destination);
    assert.equal(redirects.redirectUrl, `/session-tasks?returnTo=${encodeURIComponent(destination)}`);
    assert.equal(redirects.redirectCallbackUrl, `${mode === "signup" ? "/sign-up" : "/sign-in"}?returnTo=${encodeURIComponent(destination)}#/sso-callback`);
  }
});

test("OAuth never carries arbitrary URLs, credentials, or invitation tickets into redirects", () => {
  for (const attack of ["https://other.invalid", "//other.invalid", "/sign-in?__clerk_ticket=secret", "/join?__clerk_ticket=secret&role=org:admin", "/?token=secret"]) {
    assert.deepEqual(authProviderRedirects("signin", attack), {
      redirectUrl: "/session-tasks?returnTo=%2F",
      redirectCallbackUrl: "/sign-in?returnTo=%2F#/sso-callback",
    });
  }
  assert.equal(authProviderRedirects("signin", "/join?confirm=org_abc").redirectUrl, "/session-tasks?returnTo=%2Fjoin%3Fconfirm%3Dorg_abc");
});
