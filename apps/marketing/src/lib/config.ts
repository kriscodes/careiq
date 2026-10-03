export type PublicEnvironment = {
  siteUrl?: string;
  apiUrl?: string;
  allowIndexing?: string;
  privacyEmail?: string;
  contactEmail?: string;
  appUrl?: string;
  founderLinkedinUrl?: string;
};

function optionalUrl(value: string | undefined, label: string): string | undefined {
  if (!value?.trim()) return undefined;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`${label} must be an absolute URL`); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash || url.search) {
    throw new Error(`${label} must use HTTPS (HTTP allowed only for localhost), without credentials, query, or fragment`);
  }
  return url.href.replace(/\/+$/, "");
}

function optionalEmail(value: string | undefined, label: string): string | undefined {
  if (!value?.trim()) return undefined;
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || /[\r\n?#]/.test(email)) {
    throw new Error(`${label} must be a valid public email address`);
  }
  return email;
}

export function parseSiteConfig(environment: PublicEnvironment) {
  const siteUrl = optionalUrl(environment.siteUrl, "NEXT_PUBLIC_SITE_URL") ?? "https://careiqlabs.com";
  const apiUrl = optionalUrl(environment.apiUrl, "NEXT_PUBLIC_API_URL");
  const appUrl = optionalUrl(environment.appUrl, "NEXT_PUBLIC_APP_URL");
  const founderLinkedinUrl = optionalUrl(environment.founderLinkedinUrl, "NEXT_PUBLIC_FOUNDER_LINKEDIN_URL");
  const privacyEmail = optionalEmail(environment.privacyEmail, "NEXT_PUBLIC_PRIVACY_EMAIL");
  const contactEmail = optionalEmail(environment.contactEmail, "NEXT_PUBLIC_CONTACT_EMAIL");
  const allowIndexing = environment.allowIndexing === "true";
  if (environment.allowIndexing && !["true", "false"].includes(environment.allowIndexing)) {
    throw new Error("NEXT_PUBLIC_ALLOW_INDEXING must be true or false");
  }
  if (new URL(siteUrl).pathname !== "/") throw new Error("NEXT_PUBLIC_SITE_URL must be an origin without a path");
  if (apiUrl && new URL(apiUrl).pathname !== "/") throw new Error("NEXT_PUBLIC_API_URL must be the API origin without /api/v1");
  if (founderLinkedinUrl && !["www.linkedin.com", "linkedin.com"].includes(new URL(founderLinkedinUrl).hostname)) {
    throw new Error("NEXT_PUBLIC_FOUNDER_LINKEDIN_URL must be a LinkedIn URL");
  }
  if (allowIndexing && (siteUrl !== "https://careiqlabs.com" || !privacyEmail || !apiUrl || !apiUrl.startsWith("https://"))) {
    throw new Error("Public indexing requires the canonical https://careiqlabs.com site, a real privacy email, and an HTTPS API origin");
  }
  return { siteUrl, apiUrl, appUrl, founderLinkedinUrl, privacyEmail, contactEmail, allowIndexing, submissionEnabled: Boolean(apiUrl && privacyEmail) };
}
