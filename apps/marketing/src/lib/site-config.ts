import { parseSiteConfig } from "./config";

// Explicit accesses let Next.js incorporate only these public values at build time.
export const siteConfig = parseSiteConfig({
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  allowIndexing: process.env.NEXT_PUBLIC_ALLOW_INDEXING,
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL,
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  founderLinkedinUrl: process.env.NEXT_PUBLIC_FOUNDER_LINKEDIN_URL,
});
