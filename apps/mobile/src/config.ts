export type MobileConfiguration = {
  apiUrl: string | null;
  clerkPublishableKey: string | null;
  issues: string[];
};

function isLocalHost(host: string): boolean {
  if (["localhost", "127.0.0.1", "[::1]"].includes(host)) return true;
  const parts = host.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  );
}

export function readMobileConfiguration(
  values: { apiUrl?: string; clerkPublishableKey?: string },
  development: boolean,
): MobileConfiguration {
  const result: MobileConfiguration = {
    apiUrl: null,
    clerkPublishableKey: null,
    issues: [],
  };
  if (values.apiUrl?.trim()) {
    try {
      const url = new URL(values.apiUrl.trim());
      const secure = url.protocol === "https:";
      const local =
        development && url.protocol === "http:" && isLocalHost(url.hostname);
      if (
        (!secure && !local) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new Error();
      result.apiUrl = url.origin;
    } catch {
      result.issues.push(
        "API URL must be an HTTPS origin without a path, credentials, or query. Development builds also allow local HTTP origins.",
      );
    }
  }
  const key = values.clerkPublishableKey?.trim();
  if (key) {
    // Clerk validates the actual instance. This only rejects obvious setup mistakes.
    if (/^pk_(test|live)_[A-Za-z0-9_-]+={0,2}$/.test(key))
      result.clerkPublishableKey = key;
    else
      result.issues.push(
        "Authentication needs a Clerk publishable key beginning with pk_test_ or pk_live_.",
      );
  }
  return result;
}
