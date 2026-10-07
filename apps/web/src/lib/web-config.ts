/** Validate the destination before any session token leaves the browser. */
export function apiRequestUrl(value: string | undefined, path: string): string {
  if (!value || !path.startsWith("/api/v1/") || path.includes("\\")) throw new Error("Invalid API configuration");
  const base = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash || (base.protocol !== "https:" && !(base.protocol === "http:" && loopback))) throw new Error("Invalid API configuration");
  const target = new URL(`${base.href.replace(/\/$/, "")}${path}`);
  if (target.origin !== base.origin) throw new Error("Invalid API configuration");
  return target.href;
}
export function isDesignPreviewPath(path: string): boolean {
  let decoded = path;
  try { decoded = decodeURIComponent(path).replaceAll("\\", "/"); } catch { /* Invalid paths remain unavailable to the file server. */ }
  return decoded === "/design-preview" || decoded.startsWith("/design-preview/");
}
export function designPreviewEnabled(environment: string | undefined): boolean { return environment !== "production"; }
export function validateProductionWebConfig(env: Record<string, string | undefined>) {
  if (env.NODE_ENV !== "production") return;
  const publishable = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.match(/^pk_(test|live)_/);
  const secret = env.CLERK_SECRET_KEY?.match(/^sk_(test|live)_/);
  if (!publishable || !secret || publishable[1] !== "live" || secret[1] !== "live") throw new Error("CareIQ production web needs matching live Clerk publishable and secret keys. Test keys are permitted only in development.");
  try {
    const api = new URL(apiRequestUrl(env.NEXT_PUBLIC_API_URL, "/api/v1/me"));
    if (api.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname)) throw new Error("Invalid production API origin");
  }
  catch { throw new Error("CareIQ production web needs NEXT_PUBLIC_API_URL with a remote HTTPS origin. Credentials, query strings and fragments are not allowed."); }
}
