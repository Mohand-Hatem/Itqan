import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No "X-Powered-By: Next.js" (step 10.2a, docs/09 §2).
  poweredByHeader: false,
  output: "standalone",
};

export default nextConfig;
