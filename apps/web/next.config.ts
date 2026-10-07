import type { NextConfig } from "next";
import { validateProductionWebConfig } from "./src/lib/web-config";

validateProductionWebConfig(process.env);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Keep an isolated review server from sharing the existing local app’s build lock.
  distDir: process.env.CAREIQ_LOCAL_REVIEW_DIST_DIR || ".next",
  headers: async () => [{
    source: "/:path*",
    headers: [
      // Restrict embedding without blocking Clerk's scripts, frames, or callbacks.
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  }, ...["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"].map(source => ({ source, headers: [
    { key: "Content-Type", value: "application/json" },
    { key: "Cache-Control", value: "public, max-age=3600" },
  ] }))],
};

export default nextConfig;
