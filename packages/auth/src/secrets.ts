type Env = Record<string, string | undefined>;

const DEV_SECRET = "development-secret-for-build-and-test-only-min-32-chars";

/**
 * The Better Auth signing secret. A running production process without BETTER_AUTH_SECRET must
 * not start: a public fallback would let anyone forge verification and change-email links
 * (security audit itqan-run-1). `next build` loads this module with NODE_ENV=production but
 * signs nothing, so the build phase keeps the placeholder.
 */
export function resolveAuthSecret(env: Env = process.env): string {
  const secret = env["BETTER_AUTH_SECRET"];
  if (secret) return secret;
  if (env["NODE_ENV"] === "production" && env["NEXT_PHASE"] !== "phase-production-build") {
    throw new Error("BETTER_AUTH_SECRET must be set in production.");
  }
  return DEV_SECRET;
}
