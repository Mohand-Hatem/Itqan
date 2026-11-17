import { randomUUID } from "node:crypto";
import { auth, clearTestMailbox, DISABLED_AUTH_PATHS, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "./[...all]/route.js";

const createdUserIds: string[] = [];

beforeEach(() => {
  clearTestMailbox();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await systemPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await systemPrisma.$disconnect();
});

describe("Next.js /api/auth/* Route Handler", () => {
  it("exports GET and POST route handlers", () => {
    expect(GET).toBeTypeOf("function");
    expect(POST).toBeTypeOf("function");
  });

  it("handles GET /api/auth/get-session returning null when unauthenticated", async () => {
    const req = new Request("http://localhost:3000/api/auth/get-session", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  // ADR-012, FR-A05: public sign-up and the other unused Better Auth routes are switched off.
  it("answers 404 on every switched-off path, and public sign-up creates no user", async () => {
    expect(DISABLED_AUTH_PATHS).toHaveLength(13);
    for (const path of DISABLED_AUTH_PATHS) {
      const res = await POST(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      expect(res.status, path).toBe(404);
      const get = await GET(new Request(`http://localhost:3000/api/auth${path}`, { method: "GET" }));
      expect(get.status, path).toBe(404);
    }

    const email = `route-test-${randomUUID().slice(0, 8)}@example.com`;
    const res = await POST(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "StrongPassword123!", name: "Route Test User" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await systemPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("answers 404 for the removed two-factor routes", async () => {
    for (const path of ["/two-factor/enable", "/two-factor/verify-totp", "/mfa/status"]) {
      const res = await POST(
        new Request(`http://localhost:3000/api/auth${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      expect(res.status, path).toBe(404);
    }
  });

  it("rejects sign-in with invalid credentials", async () => {
    const req = new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "non-existent@example.com",
        password: "WrongPassword123!",
      }),
    });

    const res = await POST(req);
    expect([400, 401]).toContain(res.status);
  });

  it("handles GET /api/auth/verify-email with valid token and redirects or returns ok", async () => {
    const email = `route-verify-${randomUUID().slice(0, 8)}@example.com`;
    // Server-side creation: the HTTP sign-up route is switched off.
    const signUpBody = await auth.api.signUpEmail({
      body: { email, password: "StrongPassword123!", name: "Route Verify User" },
    });
    createdUserIds.push(signUpBody.user.id);

    const sentEmail = getLastSentEmail(email);
    expect(sentEmail?.token).toBeDefined();

    // Call GET /api/auth/verify-email?token=...
    const verifyReq = new Request(
      `http://localhost:3000/api/auth/verify-email?token=${sentEmail!.token}&callbackURL=/`,
      { method: "GET" }
    );
    const verifyRes = await GET(verifyReq);
    // Better Auth either returns 200 or 302 redirect to callbackURL
    expect([200, 302]).toContain(verifyRes.status);

    const dbUser = await systemPrisma.user.findUnique({
      where: { id: signUpBody.user!.id },
    });
    expect(dbUser!.emailVerified).toBe(true);
  });

  it("handles POST /api/auth/request-password-reset and POST /api/auth/reset-password", async () => {
    const email = `route-reset-${randomUUID().slice(0, 8)}@example.com`;
    const initialPassword = "InitialPassword123!";
    const newPassword = "NewStrongPassword456!";

    // Create and verify user (server-side: the HTTP sign-up route is switched off)
    const signUpBody = await auth.api.signUpEmail({
      body: { email, password: initialPassword, name: "Route Reset User" },
    });
    createdUserIds.push(signUpBody.user.id);

    const verifEmail = getLastSentEmail(email);
    await GET(
      new Request(`http://localhost:3000/api/auth/verify-email?token=${verifEmail!.token}`, {
        method: "GET",
      })
    );

    // Request password reset
    clearTestMailbox();
    const resetReq = new Request("http://localhost:3000/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        redirectTo: "/reset-password",
      }),
    });
    const resetRes = await POST(resetReq);
    expect(resetRes.status).toBe(200);

    const resetEmail = getLastSentEmail(email);
    expect(resetEmail?.token).toBeDefined();

    // Reset password
    const changeReq = new Request("http://localhost:3000/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: resetEmail!.token,
        newPassword,
      }),
    });
    const changeRes = await POST(changeReq);
    expect(changeRes.status).toBe(200);

    // Sign in with old password should fail
    const oldSignInRes = await POST(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: initialPassword }),
      })
    );
    expect([400, 401]).toContain(oldSignInRes.status);

    // Sign in with new password should succeed
    const newSignInRes = await POST(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: newPassword }),
      })
    );
    expect(newSignInRes.status).toBe(200);
  });
});
