import { describe, expect, it } from "vitest";
import { HealthCheckSchema } from "./health.js";

describe("HealthCheckSchema", () => {
  it("validates a healthy payload", () => {
    const valid = {
      status: "ok",
      uptime: 120.5,
      timestamp: new Date().toISOString(),
    };

    const parsed = HealthCheckSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid status", () => {
    const invalid = {
      status: "degraded",
      uptime: 10,
      timestamp: new Date().toISOString(),
    };

    const parsed = HealthCheckSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
});
