import { describe, expect, it } from "vitest";
// @ts-expect-error: plain .mjs ops script without type declarations.
import { checkTarget } from "../scripts/promote.mjs";

const neon = "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const direct = "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require";

describe("promotion target check", () => {
  it("returns the pooled and direct URLs for dev", () => {
    expect(
      checkTarget("dev", { NEON_DEV_DATABASE_URL: neon, NEON_DEV_DIRECT_URL: direct }),
    ).toEqual({ pooled: neon, direct });
  });

  it.each([
    [
      "an unknown target",
      "main",
      { NEON_DEV_DATABASE_URL: neon, NEON_DEV_DIRECT_URL: direct },
      /Unknown target/,
    ],
    [
      "a missing pooled URL",
      "dev",
      { NEON_DEV_DIRECT_URL: direct },
      /NEON_DEV_DATABASE_URL is not set/,
    ],
    [
      "a missing direct URL",
      "dev",
      { NEON_DEV_DATABASE_URL: neon },
      /NEON_DEV_DIRECT_URL is not set/,
    ],
    [
      "a local database",
      "dev",
      {
        NEON_DEV_DATABASE_URL: neon,
        NEON_DEV_DIRECT_URL: "postgresql://itqan:itqan@localhost:5433/itqan",
      },
      /points at a local database/,
    ],
    [
      "garbage",
      "dev",
      { NEON_DEV_DATABASE_URL: "not a url", NEON_DEV_DIRECT_URL: direct },
      /not a valid/,
    ],
  ])("refuses %s", (_label, target, env, message) => {
    expect(() => checkTarget(target, env)).toThrow(message);
  });
});
