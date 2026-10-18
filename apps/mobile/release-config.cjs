const identifier = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function publicHost(host) {
  return typeof host === "string" && host.length <= 253 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host) && !/^\d+(\.\d+){3}$/.test(host) && !/(^|\.)(localhost|local|test|example|invalid)$/.test(host) && !/^(.+\.)?example\.(com|net|org)$/.test(host);
}
function createMobileBuildConfig(config, env) {
  const variant = env.CAREIQ_MOBILE_VARIANT || "development";
  if (!["development", "preview", "production"].includes(variant)) throw new Error("CAREIQ_MOBILE_VARIANT must be development, preview, or production.");
  if (env.EAS_BUILD_PROFILE === "production" && variant !== "production") throw new Error("The production EAS profile must use the production mobile variant.");
  const production = variant === "production";
  const bundle = env.MOBILE_IOS_BUNDLE_ID || (variant === "preview" ? "dev.careiq.mobile.preview" : config.ios?.bundleIdentifier);
  const androidPackage = env.MOBILE_ANDROID_PACKAGE || (variant === "preview" ? "dev.careiq.mobile.preview" : config.android?.package);
  const scheme = env.MOBILE_SCHEME || (variant === "preview" ? "careiq-preview" : config.scheme);
  const linkHost = env.MOBILE_LINK_HOST?.trim().toLowerCase();
  const projectId = env.MOBILE_EAS_PROJECT_ID?.trim();
  const issues = [];
  if (production) {
    for (const [name, value] of [["MOBILE_IOS_BUNDLE_ID", bundle], ["MOBILE_ANDROID_PACKAGE", androidPackage]]) {
      if (!env[name] || !identifier.test(value) || /(^|\.)(dev|development|preview|test|example)(\.|$)/i.test(value)) issues.push(`${name} must be the registered production identifier.`);
    }
    if (!env.MOBILE_SCHEME || typeof scheme !== "string" || !/^[a-z][a-z0-9+.-]{2,63}$/.test(scheme) || /^(https?|exp|exps|file|javascript)$/.test(scheme) || /(^|[-.])(dev|preview|test)([-.]|$)/.test(scheme)) issues.push("MOBILE_SCHEME must be the registered production callback scheme.");
    try {
      const url = new URL(env.EXPO_PUBLIC_API_URL || "");
      if (url.protocol !== "https:" || !publicHost(url.hostname) || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { issues.push("EXPO_PUBLIC_API_URL must be the production HTTPS API origin."); }
    if (!/^pk_live_[A-Za-z0-9_-]+={0,2}$/.test(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "")) issues.push("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must use the matching live Clerk instance.");
    if (!publicHost(linkHost)) issues.push("MOBILE_LINK_HOST must be the verified owned invitation-link hostname.");
    if (!uuid.test(projectId || "")) issues.push("MOBILE_EAS_PROJECT_ID must identify the owning EAS project.");
  }
  if (linkHost && !publicHost(linkHost)) issues.push("MOBILE_LINK_HOST must be a public hostname without a scheme, path, or wildcard.");
  if (projectId && !uuid.test(projectId)) issues.push("MOBILE_EAS_PROJECT_ID must be a UUID.");
  if (issues.length) throw new Error(`Mobile release configuration is incomplete:\n${issues.join("\n")}`);
  const plugins = (config.plugins || []).filter(plugin => (typeof plugin === "string" ? plugin : plugin[0]) !== "expo-dev-client");
  return {
    ...config,
    name: variant === "development" ? config.name : variant === "preview" ? "CareIQ Preview" : "CareIQ",
    scheme,
    plugins: [...plugins, ["expo-dev-client", { addGeneratedScheme: variant === "development" }], ...(variant === "development" ? [] : ["./plugins/with-release-transport.cjs"])],
    ios: { ...config.ios, bundleIdentifier: bundle, ...(linkHost ? { associatedDomains: [`applinks:${linkHost}`] } : {}) },
    android: {
      ...config.android, package: androidPackage, allowBackup: false,
      ...(linkHost ? { intentFilters: [{ action: "VIEW", autoVerify: true, category: ["BROWSABLE", "DEFAULT"], data: [{ scheme: "https", host: linkHost, path: "/join" }, { scheme: "https", host: linkHost, path: "/patient-workflow" }] }] } : {}),
    },
    extra: { ...config.extra, mobileVariant: variant, ...(projectId ? { eas: { projectId } } : {}) },
  };
}
module.exports = { createMobileBuildConfig };
