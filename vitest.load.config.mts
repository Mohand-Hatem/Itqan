import { defineConfig } from "vitest/config";
import base from "./vitest.config.mjs";

// Load tests only (NFR-02, NFR-03). Run alone so other suites don't skew the latency numbers.
// The include/exclude lists replace the base ones (mergeConfig would concatenate them).
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["**/*.load.spec.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    testTimeout: 120_000,
  },
});
