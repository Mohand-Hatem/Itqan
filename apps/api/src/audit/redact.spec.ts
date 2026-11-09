import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("hides secret-looking keys at any depth and keeps the rest", () => {
    const at = new Date("2026-01-01T00:00:00Z");
    expect(
      redact({
        email: "a@b.com",
        password: "p",
        newPassword: "p",
        accessCode: "XXXX-XXXX",
        device: {
          secret: "s",
          name: "Laptop",
          headers: { Authorization: "Bearer x", cookie: "c" },
        },
        list: [{ token: "t", id: 1 }],
        apiKey: "k",
        at,
      }),
    ).toEqual({
      email: "a@b.com",
      password: "[redacted]",
      newPassword: "[redacted]",
      accessCode: "[redacted]",
      device: {
        secret: "[redacted]",
        name: "Laptop",
        headers: { Authorization: "[redacted]", cookie: "[redacted]" },
      },
      list: [{ token: "[redacted]", id: 1 }],
      apiKey: "[redacted]",
      at,
    });
  });

  it("leaves plain values alone", () => {
    expect(redact("text")).toBe("text");
    expect(redact(null)).toBeNull();
    expect(redact(3)).toBe(3);
  });
});
