import { describe, expect, it } from "vitest";
import { resolveAuthSecret } from "./secrets.js";

// Step 10.3 (audit lead packages/auth/src/auth.ts:betterAuth.secret:hardcoded-fallback).
describe("resolveAuthSecret", () => {
  it("uses BETTER_AUTH_SECRET when set", () => {
    expect(resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "real-secret" })).toBe("real-secret");
  });

  it("refuses to run in production without a secret (no public fallback)", () => {
    expect(() => resolveAuthSecret({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "" })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("lets `next build` load the module without a secret (nothing is signed at build time)", () => {
    expect(resolveAuthSecret({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).toBeTruthy();
  });

  it("keeps a local fallback for development and tests", () => {
    expect(resolveAuthSecret({ NODE_ENV: "test" })).toBeTruthy();
    expect(resolveAuthSecret({})).toBeTruthy();
  });
});
