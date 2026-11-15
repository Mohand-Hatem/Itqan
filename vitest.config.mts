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
    // JOBS_ENABLED=false: the scheduled-job timers never start in tests; tests call the jobs.
    env: { DATABASE_URL: process.env["TEST_DATABASE_URL"] ?? "", JOBS_ENABLED: "false" },
    include: ["**/*.spec.ts", "**/*.test.ts"],
    // Integration tests hash several passwords (scrypt) each; with every file running in
    // parallel, 1–2 s tests went past the 5 s default. Assertions are unchanged.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Load tests (*.load.spec.ts) measure latency, so they run alone: `npm run test:load`.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/*.load.spec.ts"],
  },
});
