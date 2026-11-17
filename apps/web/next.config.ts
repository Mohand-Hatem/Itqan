import { resolve } from "node:path";
import type { NextConfig } from "next";

// `next dev` only: the one .env is at the repository root, the same file the API reads.
// `next build` (NODE_ENV=production) never reads it; production gets its variables from the container.
if (process.env["NODE_ENV"] !== "production") {
  try {
    process.loadEnvFile(resolve(process.cwd(), "../../.env"));
  } catch {
    // No root .env: the environment already has the variables.
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No "X-Powered-By: Next.js" (step 10.2a, docs/09 §2).
  poweredByHeader: false,
  output: "standalone",
};

export default nextConfig;
