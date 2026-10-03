import { isIP } from "node:net";

/** Exact browser origins only. Paths, credentials, wildcards and null origins are rejected. */
export function parseCorsOrigins(environment: NodeJS.ProcessEnv = process.env): string[] {
  const raw = environment.CORS_ORIGINS;
  if (!raw?.trim() && environment.NODE_ENV === "production") {
    throw new Error("CORS_ORIGINS must be configured in production.");
  }
  const configured = raw?.trim() || "http://localhost:3001,http://localhost:3002";
  return [...new Set(configured.split(",").map((value) => {
    const trimmed = value.trim().replace(/\/+$/, "");
    let url: URL;
    try { url = new URL(trimmed); } catch { throw new Error("CORS_ORIGINS must contain valid HTTP(S) origins."); }
    if (!["http:", "https:"].includes(url.protocol) || url.hostname.includes("*") || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
      throw new Error("CORS_ORIGINS must contain origins without paths, credentials, queries or fragments.");
    }
    return url.origin;
  }))];
}

/** Opt in only after checking the hosting network; never trust a supplied hop count or all proxies. */
export function parseTrustedProxies(value = process.env.TRUSTED_PROXY_CIDRS): false | string[] {
  if (!value?.trim()) return false;
  const proxies = value.split(",").map((entry) => entry.trim());
  for (const proxy of proxies) {
    const parts = proxy.split("/");
    const address = parts[0]!;
    const version = isIP(address);
    const prefix = parts[1];
    const maximum = version === 4 ? 32 : 128;
    const minimum = version === 4 ? 16 : 32;
    if (!version || parts.length > 2 || address === "0.0.0.0" || address === "::" ||
      (prefix !== undefined && (!/^\d{1,3}$/.test(prefix) || Number(prefix) < minimum || Number(prefix) > maximum))) {
      throw new Error("TRUSTED_PROXY_CIDRS must contain explicit proxy IPs or narrow CIDRs (IPv4 /16–/32; IPv6 /32–/128).");
    }
  }
  return proxies;
}

export function interviewRequestsEnabled(value = process.env.INTERVIEW_REQUESTS_ENABLED): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("INTERVIEW_REQUESTS_ENABLED must be true or false.");
}
