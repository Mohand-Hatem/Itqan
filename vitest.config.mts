import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Load the root .env (TEST_DATABASE_URL) for integration tests. CI sets the variables directly.
config({ quiet: true });

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    globalSetup: ["./vitest.global-setup.mts"],
    // Code under test that uses the shared client must hit itqan_test, never dev data.
    env: { DATABASE_URL: process.env["TEST_DATABASE_URL"] ?? "" },
    include: ["**/*.spec.ts", "**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
  },
});
