import type { MetadataRoute } from "next";
import { siteConfig } from "../lib/site-config";
export const dynamic = "force-static";
export default function robots(): MetadataRoute.Robots {
  return siteConfig.allowIndexing
    ? { rules: { userAgent: "*", allow: "/" }, sitemap: `${siteConfig.siteUrl}/sitemap.xml` }
    : { rules: { userAgent: "*", disallow: "/" } };
}
