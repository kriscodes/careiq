/** Fixture/grant tests never use the live review or a hosted database. */
export function isolatedTestDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = environment.TEST_DATABASE_URL;
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("API database tests require an isolated loopback careiq_test URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/careiq_test" || url.search || url.hash) throw new Error("API database tests require an isolated loopback careiq_test URL without query overrides or fragments.");
  return value;
}
