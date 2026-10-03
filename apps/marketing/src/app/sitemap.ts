import type { MetadataRoute } from "next";
import { siteConfig } from "../lib/site-config";
export const dynamic = "force-static";
export default function sitemap(): MetadataRoute.Sitemap {
  return siteConfig.allowIndexing ? [{ url: `${siteConfig.siteUrl}/`, priority: 1 }, { url: `${siteConfig.siteUrl}/privacy/`, priority: 0.3 }] : [];
}
