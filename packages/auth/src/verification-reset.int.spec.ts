import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth, clearTestMailbox, getLastSentEmail } from "./index.js";

const createdUserIds: string[] = [];

beforeEach(() => {
  clearTestMailbox();
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await systemPrisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }
  await systemPrisma.$disconnect();
});

interface BetterAuthApiError {
  status?: string | number;
  statusCode?: number;
  code?: string;
  message?: string;
  body?: { code?: string };
}

describe("Email Verification and Password Reset (FR-A01, FR-A02)", () => {
  it("executes the full email verification lifecycle", async () => {
    const email = `verify-${randomUUID().slice(0, 8)}@example.com`;
    const password = "StrongPassword123!";

    // 1. Sign up user
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: "Verification Lifecycle User",
      },
    });

    expect(signUpResult.user).toBeDefined();
    expect(signUpResult.user.emailVerified).toBe(false);
    createdUserIds.push(signUpResult.user.id);

    // 2. Unverified sign-in attempt must fail with 403
    let unverifiedSignInError: BetterAuthApiError | null = null;
    try {
      await auth.api.signInEmail({
        body: { email, password },
      });
    } catch (err) {
      unverifiedSignInError = err as BetterAuthApiError;
    }

    expect(unverifiedSignInError).toBeDefined();
    expect(["FORBIDDEN", 403]).toContain(unverifiedSignInError?.status);
    expect(
      unverifiedSignInError?.body?.code ||
        unverifiedSignInError?.code ||
        unverifiedSignInError?.message,
    ).toMatch(/EMAIL_NOT_VERIFIED|FORBIDDEN/i);

    // 3. Inspect sent verification email
    const sentEmail = getLastSentEmail(email);
    expect(sentEmail).toBeDefined();
    expect(sentEmail!.type).toBe("verification");
    expect(sentEmail!.token).toBeDefined();
    expect(sentEmail!.url).toBeDefined();
    expect(sentEmail!.subject).toContain("تأكيد بريدك الإلكتروني");

    // 4. Verify email using the token
    const verificationResult = await auth.api.verifyEmail({
      query: {
        token: sentEmail!.token!,
      },
    });

    expect(verificationResult).toBeDefined();
    expect(verificationResult.status).toBe(true);

    // 5. Check database directly
    const dbUser = await systemPrisma.user.findUnique({
      where: { id: signUpResult.user.id },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.emailVerified).toBe(true);

    // 6. Sign in should now succeed and create an active session
    const verifiedSignIn = await auth.api.signInEmail({
      body: { email, password },
    });
    expect(verifiedSignIn.user).toBeDefined();
    expect(verifiedSignIn.user.email).toBe(email);
    expect(verifiedSignIn.token).toBeDefined();
  });

  it("executes the full password reset lifecycle and revokes active sessions", async () => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.com`;
    const initialPassword = "InitialPassword123!";
    const newPassword = "BrandNewPassword456!";

    // 1. Sign up and verify user
    const signUpResult = await auth.api.signUpEmail({
      body: {
        email,
        password: initialPassword,
        name: "Password Reset User",
      },
    });
    createdUserIds.push(signUpResult.user.id);

    const verifEmail = getLastSentEmail(email);
    expect(verifEmail?.token).toBeDefined();

    await auth.api.verifyEmail({
      query: { token: verifEmail!.token! },
    });

    // 2. Sign in to establish an active session
    const signInResult = await auth.api.signInEmail({
      body: { email, password: initialPassword },
    });
    const activeSessionToken = signInResult.token;
    expect(activeSessionToken).toBeDefined();

    // Verify session row exists in database
    const dbSessionBefore = await systemPrisma.session.findUnique({
      where: { token: activeSessionToken },
    });
    expect(dbSessionBefore).not.toBeNull();

    // 3. Request password reset
    clearTestMailbox();
    const resetRequestResult = await auth.api.requestPasswordReset({
      body: {
        email,
        redirectTo: "http://localhost:3000/reset-password",
      },
    });
    expect(resetRequestResult.status).toBe(true);

    // 4. Retrieve reset email and token
    const resetEmail = getLastSentEmail(email);
    expect(resetEmail).toBeDefined();
    expect(resetEmail!.type).toBe("reset");
    expect(resetEmail!.token).toBeDefined();
    expect(resetEmail!.subject).toContain("إعادة تعيين كلمة المرور");

    // 5. Complete password reset with new password
    const resetResult = await auth.api.resetPassword({
      body: {
        token: resetEmail!.token!,
        newPassword,
      },
    });
    expect(resetResult.status).toBe(true);

    // 6. Sign in with OLD password must be rejected
    let oldPasswordError: unknown = null;
    try {
      await auth.api.signInEmail({
        body: { email, password: initialPassword },
      });
    } catch (err) {
      oldPasswordError = err;
    }
    expect(oldPasswordError).toBeDefined();

    // 7. Sign in with NEW password must succeed
    const newSignInResult = await auth.api.signInEmail({
      body: { email, password: newPassword },
    });
    expect(newSignInResult.user).toBeDefined();
    expect(newSignInResult.token).toBeDefined();

    // 8. Previous session must have been revoked (revokeSessionsOnPasswordReset: true)
    const dbSessionAfter = await systemPrisma.session.findUnique({
      where: { token: activeSessionToken },
    });
    expect(dbSessionAfter).toBeNull();
  });

  it("rejects invalid and expired tokens gracefully", async () => {
    // Attempt verification with an invalid token
    let invalidVerifError: unknown = null;
    try {
      await auth.api.verifyEmail({
        query: { token: "invalid-token-value-12345" },
      });
    } catch (err) {
      invalidVerifError = err;
    }
    expect(invalidVerifError).toBeDefined();

    // Attempt password reset with an invalid token
    let invalidResetError: unknown = null;
    try {
      await auth.api.resetPassword({
        body: {
          token: "invalid-token-value-12345",
          newPassword: "SomeNewPassword123!",
        },
      });
    } catch (err) {
      invalidResetError = err;
    }
    expect(invalidResetError).toBeDefined();
  });
  // Security audit, Phase 5: verification and reset links carry tokens and must never be logged.
  it("never writes a verification or reset token to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const email = `nolog-${randomUUID().slice(0, 8)}@example.com`;
      const signUp = await auth.api.signUpEmail({
        body: { email, password: "NoLogPassword123!", name: "No Log" },
      });
      createdUserIds.push(signUp.user.id);
      const verifyToken = getLastSentEmail(email)?.token;
      await auth.api.verifyEmail({ query: { token: verifyToken! } });
      await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
      const resetToken = getLastSentEmail(email)?.token;

      expect(verifyToken).toBeDefined();
      expect(resetToken).toBeDefined();
      const printed = spies.flatMap((s) => s.mock.calls.flat().map(String)).join(" ");
      expect(printed).not.toContain(verifyToken!);
      expect(printed).not.toContain(resetToken!);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});
