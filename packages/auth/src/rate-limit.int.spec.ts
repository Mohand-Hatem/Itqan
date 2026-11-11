import { describe, expect, it } from "vitest";
import { auth } from "./auth.js";

describe("Auth Endpoint Rate Limiting (FR-A01, FR-A02, §10)", () => {
  it("enforces 5 requests / min on /sign-in/email and blocks 6th with 429", async () => {
    const testIp = "198.51.100.10";

    // 5 attempts should be processed by the handler (returns 400 or 401 for bad credentials)
    for (let i = 0; i < 5; i++) {
      const req = new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": testIp,
        },
        body: JSON.stringify({
          email: "nonexistent@example.com",
          password: "WrongPassword123!",
        }),
      });

      const res = await auth.handler(req);
      expect([400, 401]).toContain(res.status);
    }

    // 6th attempt should be blocked with HTTP 429 Too Many Requests
    const blockedReq = new Request(
      "http://localhost:3000/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": testIp,
        },
        body: JSON.stringify({
          email: "nonexistent@example.com",
          password: "WrongPassword123!",
        }),
      },
    );

    const blockedRes = await auth.handler(blockedReq);
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("x-retry-after")).toBeDefined();

    // Another IP should NOT be blocked
    const otherIpReq = new Request(
      "http://localhost:3000/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.11",
        },
        body: JSON.stringify({
          email: "nonexistent@example.com",
          password: "WrongPassword123!",
        }),
      },
    );

    const otherRes = await auth.handler(otherIpReq);
    expect([400, 401]).toContain(otherRes.status);
  });

  it("enforces 3 requests / 15 min on /request-password-reset and blocks 4th with 429", async () => {
    const testIp = "198.51.100.20";

    // 3 attempts are allowed
    for (let i = 0; i < 3; i++) {
      const req = new Request(
        "http://localhost:3000/api/auth/request-password-reset",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": testIp,
          },
          body: JSON.stringify({
            email: "reset-target@example.com",
            redirectTo: "/reset-password",
          }),
        },
      );

      const res = await auth.handler(req);
      expect([200, 400, 404]).toContain(res.status);
    }

    // 4th attempt should be blocked with 429
    const blockedReq = new Request(
      "http://localhost:3000/api/auth/request-password-reset",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": testIp,
        },
        body: JSON.stringify({
          email: "reset-target@example.com",
          redirectTo: "/reset-password",
        }),
      },
    );

    const blockedRes = await auth.handler(blockedReq);
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("x-retry-after")).toBeDefined();
  });

  it("enforces 3 requests / 15 min on /send-verification-email and blocks 4th with 429", async () => {
    const testIp = "198.51.100.30";

    // 3 attempts are allowed
    for (let i = 0; i < 3; i++) {
      const req = new Request(
        "http://localhost:3000/api/auth/send-verification-email",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": testIp,
          },
          body: JSON.stringify({
            email: "verify-target@example.com",
          }),
        },
      );

      const res = await auth.handler(req);
      expect([200, 400, 404]).toContain(res.status);
    }

    // 4th attempt should be blocked with 429
    const blockedReq = new Request(
      "http://localhost:3000/api/auth/send-verification-email",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": testIp,
        },
        body: JSON.stringify({
          email: "verify-target@example.com",
        }),
      },
    );

    const blockedRes = await auth.handler(blockedReq);
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("x-retry-after")).toBeDefined();
  });
});
