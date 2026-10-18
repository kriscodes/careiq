import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { createMobileBuildConfig } = require("../release-config.cjs");
const base = { name: "CareIQ Mobile", scheme: "careiq-dev", ios: { bundleIdentifier: "dev.careiq.mobile" }, android: { package: "dev.careiq.mobile" }, plugins: ["expo-router"] };
const release = {
  CAREIQ_MOBILE_VARIANT: "production", MOBILE_IOS_BUNDLE_ID: "com.careiqfixture.mobile", MOBILE_ANDROID_PACKAGE: "com.careiqfixture.mobile",
  MOBILE_SCHEME: "careiqfixture", MOBILE_LINK_HOST: "links.careiqfixture.com", MOBILE_EAS_PROJECT_ID: "14fa9eb8-dc63-497b-9bc9-4bdf3f350f20",
  EXPO_PUBLIC_API_URL: "https://api.careiqfixture.com", EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_syntheticfixture",
};
test("unconfigured development remains usable and preview has distinct identifiers", () => {
  const dev = createMobileBuildConfig(base, {});
  const preview = createMobileBuildConfig(base, { CAREIQ_MOBILE_VARIANT: "preview" });
  assert.equal(dev.scheme, "careiq-dev");
  assert.notEqual(dev.ios.bundleIdentifier, preview.ios.bundleIdentifier);
  assert.notEqual(dev.android.package, preview.android.package);
  assert.notEqual(dev.scheme, preview.scheme);
  assert.equal(dev.android.allowBackup, false);
});
test("production fails closed for every missing public setup value", () => {
  for (const name of Object.keys(release).filter(key => key !== "CAREIQ_MOBILE_VARIANT")) {
    const values = { ...release } as Record<string, string>;
    delete values[name];
    assert.throws(() => createMobileBuildConfig(base, values), /Mobile release configuration is incomplete/);
  }
  assert.throws(() => createMobileBuildConfig(base, { EAS_BUILD_PROFILE: "production" }), /production mobile variant/);
});
test("test keys, development identifiers, insecure origins and malformed links cannot become production configuration", () => {
  for (const override of [
    { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fixture" }, { EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_live_sensitive" },
    { EXPO_PUBLIC_API_URL: "http://localhost:3100" }, { EXPO_PUBLIC_API_URL: "https://127.0.0.1" },
    { EXPO_PUBLIC_API_URL: "https://api.careiqfixture.com/path" }, { MOBILE_IOS_BUNDLE_ID: "dev.careiq.mobile" },
    { MOBILE_SCHEME: "careiq-dev" }, { MOBILE_LINK_HOST: "https://links.careiqfixture.com/join" }, { MOBILE_LINK_HOST: "*.careiqfixture.com" },
  ]) assert.throws(() => createMobileBuildConfig(base, { ...release, ...override }), /Mobile release configuration is incomplete/);
  try { createMobileBuildConfig(base, { ...release, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_live_sensitive" }); assert.fail("Expected configuration rejection"); } catch (error) { assert.equal(String(error).includes("sensitive"), false); }
});
test("owned-link configuration restricts Android link routing and production omits the development client scheme", () => {
  const config = createMobileBuildConfig(base, release);
  assert.deepEqual(config.ios.associatedDomains, ["applinks:links.careiqfixture.com"]);
  assert.deepEqual(config.android.intentFilters[0].data, [{ scheme: "https", host: "links.careiqfixture.com", path: "/join" }, { scheme: "https", host: "links.careiqfixture.com", path: "/patient-workflow" }]);
  assert.equal(config.android.intentFilters[0].autoVerify, true);
  assert.deepEqual(config.plugins.at(-2), ["expo-dev-client", { addGeneratedScheme: false }]);
  assert.equal(config.plugins.at(-1), "./plugins/with-release-transport.cjs");
});
