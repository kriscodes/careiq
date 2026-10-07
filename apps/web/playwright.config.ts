import { defineConfig } from "@playwright/test";
for (const key of ["CAREIQ_WEB_TEST_URL", "CAREIQ_WEB_PRODUCTION_URL"]) {
  const value = process.env[key];
  if (!value) continue;
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error(`${key} must point to an isolated loopback web server.`);
}
export default defineConfig({
  testDir: "./tests/browser",
  projects: [
    { name: "components", testMatch: "components.spec.ts" },
    ...(process.env.CAREIQ_WEB_TEST_URL ? [{ name: "live", testMatch: "live.spec.ts", use: { baseURL: process.env.CAREIQ_WEB_TEST_URL } }] : []),
    ...(process.env.CAREIQ_WEB_PRODUCTION_URL ? [{ name: "production", testMatch: "production.spec.ts", use: { baseURL: process.env.CAREIQ_WEB_PRODUCTION_URL } }] : []),
  ],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/browser",
  use: { browserName: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL, viewport: { width: 1280, height: 900 }, trace: "off", screenshot: "off", video: "off" },
});
