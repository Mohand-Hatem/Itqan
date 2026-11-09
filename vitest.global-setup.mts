import { execSync } from "node:child_process";

// Bring itqan_test up to the latest migration before any test runs (locally and in CI).
export default function setup(): void {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up`.",
    );
  }
  execSync("npx prisma migrate deploy", {
    cwd: "packages/database",
    env: { ...process.env, DATABASE_URL: url },
    stdio: ["ignore", "ignore", "inherit"],
  });
}
