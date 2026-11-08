import { describe, expect, it } from "vitest";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("returns status ok and valid uptime", () => {
    const controller = new HealthController();
    const result = controller.getHealth();

    expect(result.status).toBe("ok");
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.timestamp)).not.toBeNaN();
  });
});
