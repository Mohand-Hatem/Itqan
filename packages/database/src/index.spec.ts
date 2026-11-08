import { describe, expect, it } from "vitest";
import { DATABASE_VERSION } from "./index.js";

describe("packages/database", () => {
  it("exports package version constant", () => {
    expect(DATABASE_VERSION).toBe("0.1.0");
  });
});
