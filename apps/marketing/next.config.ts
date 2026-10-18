import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.CAREIQ_LOCAL_REVIEW_DIST_DIR || ".next",
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
