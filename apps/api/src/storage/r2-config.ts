// Cloudflare R2 settings from env (step 7.1, docs/10-dev-setup.md). Errors name the variables,
// never their values: the secret must not reach logs.
export const R2_ENV_NAMES = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_PRIVATE_BUCKET",
  "R2_PUBLIC_BUCKET",
  "R2_PUBLIC_URL",
] as const;

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: { private: string; public: string };
  publicUrl: string;
};

export function loadR2Config(env: Record<string, string | undefined> = process.env): R2Config {
  const missing = R2_ENV_NAMES.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(
      `R2 is not configured: set ${missing.join(", ")} in .env (docs/10-dev-setup.md).`,
    );
  }
  const value = (name: (typeof R2_ENV_NAMES)[number]) => env[name]!;

  if (!/^[0-9a-f]{32}$/.test(value("R2_ACCOUNT_ID"))) {
    throw new Error("R2_ACCOUNT_ID must be the 32-character account ID from the R2 dashboard.");
  }
  if (!/^https:\/\/[^/]+(\/[^/]+)*$/.test(value("R2_PUBLIC_URL"))) {
    throw new Error("R2_PUBLIC_URL must be an https URL with no trailing slash.");
  }
  return {
    accountId: value("R2_ACCOUNT_ID"),
    accessKeyId: value("R2_ACCESS_KEY_ID"),
    secretAccessKey: value("R2_SECRET_ACCESS_KEY"),
    buckets: { private: value("R2_PRIVATE_BUCKET"), public: value("R2_PUBLIC_BUCKET") },
    publicUrl: value("R2_PUBLIC_URL"),
  };
}
