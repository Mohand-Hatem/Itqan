import { describe, expect, it } from "vitest";
import { AUTH_VERSION } from "./index.js";

describe("packages/auth", () => {
  it("exports package version constant", () => {
    expect(AUTH_VERSION).toBe("0.1.0");
  });
});
