import { describe, expect, it } from "vitest";
import { TenantSlugSchema } from "./tenant.js";

describe("TenantSlugSchema", () => {
  it("accepts valid alphanumeric-hyphen slug", () => {
    expect(TenantSlugSchema.safeParse("itqan-academy").success).toBe(true);
  });

  it("rejects uppercase and invalid characters", () => {
    expect(TenantSlugSchema.safeParse("Itqan_Academy!").success).toBe(false);
  });
});
