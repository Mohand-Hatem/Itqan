import { describe, expect, it } from "vitest";
import { TenantSlugSchema } from "@itqan/shared";

describe("Web App Home Logic", () => {
  it("validates demo tenant slug correctly", () => {
    const slug = "itqan-demo";
    expect(TenantSlugSchema.safeParse(slug).success).toBe(true);
  });
});
