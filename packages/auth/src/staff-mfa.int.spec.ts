import { randomUUID } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auth,
  checkStaffMfaRequirement,
  getLastSentEmail,
  isStaffOrSuperAdmin,
  MFA_ENROLMENT_REQUIRED_REASON,
} from "./index.js";

const createdUserIds: string[] = [];
let testTenantId: string;

function toCookieHeader(headers: Headers): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") || ""];

  return setCookies
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

beforeAll(async () => {
  const tenant = await systemPrisma.tenant.create({
    data: {
      slug: `mfa-test-${randomUUID().slice(0, 8)}`,
      name: "MFA Test Tenant",
    },
  });
  testTenantId = tenant.id;
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await systemPrisma.membership.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await systemPrisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }
  if (testTenantId) {
    await systemPrisma.tenant.delete({
      where: { id: testTenantId },
    });
  }
  await systemPrisma.$disconnect();
});

describe("Staff and Super Admin TOTP MFA Enforcement (FR-A03)", () => {
  it("correctly identifies staff, super admin, and regular students", async () => {
    // 1. Student User
    const studentUser = await systemPrisma.user.create({
      data: {
        email: `student-${randomUUID().slice(0, 8)}@example.com`,
        name: "Student User",
        emailVerified: true,
      },
    });
    createdUserIds.push(studentUser.id);
    await systemPrisma.membership.create({
      data: {
        userId: studentUser.id,
        tenantId: testTenantId,
        role: "student",
      },
    });

    const isStudentStaff = await isStaffOrSuperAdmin(studentUser.id);
    expect(isStudentStaff).toBe(false);

    const studentMfa = await checkStaffMfaRequirement(studentUser);
    expect(studentMfa.mfaRequired).toBe(false);
    expect(studentMfa.enrolmentRequired).toBe(false);

    // 2. Teacher User
    const teacherUser = await systemPrisma.user.create({
      data: {
        email: `teacher-${randomUUID().slice(0, 8)}@example.com`,
        name: "Teacher User",
        emailVerified: true,
      },
    });
    createdUserIds.push(teacherUser.id);
    await systemPrisma.membership.create({
      data: {
        userId: teacherUser.id,
        tenantId: testTenantId,
        role: "teacher",
      },
    });

    const isTeacherStaff = await isStaffOrSuperAdmin(teacherUser.id);
    expect(isTeacherStaff).toBe(true);

    const teacherMfa = await checkStaffMfaRequirement(teacherUser);
    expect(teacherMfa.mfaRequired).toBe(true);
    expect(teacherMfa.enrolmentRequired).toBe(true);
    expect(teacherMfa.reason).toBe(MFA_ENROLMENT_REQUIRED_REASON);

    // 3. Assistant User
    const assistantUser = await systemPrisma.user.create({
      data: {
        email: `assistant-${randomUUID().slice(0, 8)}@example.com`,
        name: "Assistant User",
        emailVerified: true,
      },
    });
    createdUserIds.push(assistantUser.id);
    await systemPrisma.membership.create({
      data: {
        userId: assistantUser.id,
        tenantId: testTenantId,
        role: "assistant",
      },
    });

    const isAssistantStaff = await isStaffOrSuperAdmin(assistantUser.id);
    expect(isAssistantStaff).toBe(true);

    const assistantMfa = await checkStaffMfaRequirement(assistantUser);
    expect(assistantMfa.mfaRequired).toBe(true);
    expect(assistantMfa.enrolmentRequired).toBe(true);

    // 4. Super Admin User
    const superAdminUser = await systemPrisma.user.create({
      data: {
        email: `superadmin-${randomUUID().slice(0, 8)}@example.com`,
        name: "Super Admin User",
        emailVerified: true,
        isSuperAdmin: true,
      },
    });
    createdUserIds.push(superAdminUser.id);

    const isSuperAdminStaff = await isStaffOrSuperAdmin(superAdminUser.id, superAdminUser);
    expect(isSuperAdminStaff).toBe(true);

    const superAdminMfa = await checkStaffMfaRequirement(superAdminUser);
    expect(superAdminMfa.mfaRequired).toBe(true);
    expect(superAdminMfa.enrolmentRequired).toBe(true);
    expect(superAdminMfa.reason).toBe(MFA_ENROLMENT_REQUIRED_REASON);
  });

  it("signals MFA enrolment required when staff logs in without TOTP enabled", async () => {
    const email = `staff-login-${randomUUID().slice(0, 8)}@example.com`;
    const password = "StrongStaffPassword123!";

    // 1. Sign up user through auth
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name: "Staff Member" },
    });
    createdUserIds.push(signUp.user.id);

    // Verify email
    const verif = getLastSentEmail(email);
    expect(verif?.token).toBeDefined();
    await auth.api.verifyEmail({ query: { token: verif!.token! } });

    // Assign teacher role
    await systemPrisma.membership.create({
      data: {
        userId: signUp.user.id,
        tenantId: testTenantId,
        role: "teacher",
      },
    });

    // 2. Sign in as teacher
    const signInResult = (await auth.api.signInEmail({
      body: { email, password },
    })) as {
      user?: { id: string };
      token?: string;
      mfaEnrolmentRequired?: boolean;
      reason?: string;
    };

    expect(signInResult.user).toBeDefined();
    expect(signInResult.mfaEnrolmentRequired).toBe(true);
    expect(signInResult.reason).toBe(MFA_ENROLMENT_REQUIRED_REASON);
  });

  it("completes full TOTP enrolment and enforces 2FA challenge on subsequent logins", async () => {
    const email = `totp-full-${randomUUID().slice(0, 8)}@example.com`;
    const password = "StrongTeacherPassword123!";

    // 1. Sign up, verify email, assign teacher membership
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name: "Full TOTP Teacher" },
    });
    createdUserIds.push(signUp.user.id);

    const verif = getLastSentEmail(email);
    await auth.api.verifyEmail({ query: { token: verif!.token! } });

    await systemPrisma.membership.create({
      data: {
        userId: signUp.user.id,
        tenantId: testTenantId,
        role: "teacher",
      },
    });

    // 2. Sign in to obtain session
    const signInWithHeaders = await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    });
    const sessionCookie = signInWithHeaders.headers.get("set-cookie");
    expect(sessionCookie).toBeDefined();

    const authHeaders = new Headers();
    authHeaders.set("cookie", sessionCookie!);

    // 3. Enable TOTP 2FA
    const enableResult = await auth.api.enableTwoFactor({
      body: { password, method: "totp" },
      headers: authHeaders,
    });

    expect(enableResult.totpURI).toBeDefined();
    expect(enableResult.backupCodes).toBeDefined();
    expect(enableResult.backupCodes.length).toBeGreaterThan(0);

    // Extract secret from totpURI (otpauth://totp/Itqan:...?secret=BASE32...)
    const totpUrl = new URL(enableResult.totpURI);
    const base32Secret = totpUrl.searchParams.get("secret");
    expect(base32Secret).toBeTruthy();
    expect(totpUrl.searchParams.get("issuer")).toBe("Itqan");

    // Authenticator apps decode the Base32 secret from the URI to generate TOTP codes
    const rawSecret = new TextDecoder().decode(base32.decode(base32Secret!));
    const otp = createOTP(rawSecret);
    const validCode = await otp.totp();

    const verifyTOTPResult = await auth.api.verifyTOTP({
      body: { code: validCode },
      headers: authHeaders,
    });

    expect(verifyTOTPResult.user).toBeDefined();

    // Verify database reflects twoFactorEnabled: true
    const updatedUser = await systemPrisma.user.findUnique({
      where: { id: signUp.user.id },
    });
    expect(updatedUser!.twoFactorEnabled).toBe(true);

    // 5. Subsequent sign-in must now require 2FA challenge
    const secondSignIn = (await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    })) as {
      response: { twoFactorRedirect?: boolean; twoFactorMethods?: string[] };
      headers: Headers;
    };

    expect(secondSignIn.response.twoFactorRedirect).toBe(true);
    expect(secondSignIn.response.twoFactorMethods).toContain("totp");

    const challengeHeaders = new Headers();
    challengeHeaders.set("cookie", toCookieHeader(secondSignIn.headers));

    // 6. Verification with wrong code is rejected
    let wrongCodeError: unknown = null;
    try {
      await auth.api.verifyTOTP({
        body: { code: "000000" },
        headers: challengeHeaders,
      });
    } catch (err) {
      wrongCodeError = err;
    }
    expect(wrongCodeError).toBeDefined();

    // 7. Verification with correct TOTP code succeeds and grants full session
    const currentCode = await otp.totp();
    const challengeVerify = (await auth.api.verifyTOTP({
      body: { code: currentCode },
      headers: challengeHeaders,
      returnHeaders: true,
    })) as {
      response: { token?: string; user?: unknown };
      headers: Headers;
    };

    expect(challengeVerify.response.token).toBeDefined();
    const fullSessionCookie = toCookieHeader(challengeVerify.headers);
    expect(fullSessionCookie).toContain("better-auth.session_token");

    // 8. Sign-in using a backup code
    const thirdSignIn = (await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    })) as {
      response: { twoFactorRedirect?: boolean };
      headers: Headers;
    };
    expect(thirdSignIn.response.twoFactorRedirect).toBe(true);

    const backupHeaders = new Headers();
    backupHeaders.set("cookie", toCookieHeader(thirdSignIn.headers));

    const backupCodeToUse = enableResult.backupCodes[0];
    const backupVerify = (await auth.api.verifyBackupCode({
      body: { code: backupCodeToUse },
      headers: backupHeaders,
      returnHeaders: true,
    })) as {
      response: { token?: string };
      headers: Headers;
    };
    expect(backupVerify.response.token).toBeDefined();

    // Reusing the same backup code must be rejected
    const fourthSignIn = (await auth.api.signInEmail({
      body: { email, password },
      returnHeaders: true,
    })) as {
      response: { twoFactorRedirect?: boolean };
      headers: Headers;
    };
    const reusedBackupHeaders = new Headers();
    reusedBackupHeaders.set("cookie", toCookieHeader(fourthSignIn.headers));

    let reusedCodeError: unknown = null;
    try {
      await auth.api.verifyBackupCode({
        body: { code: backupCodeToUse },
        headers: reusedBackupHeaders,
      });
    } catch (err) {
      reusedCodeError = err;
    }
    expect(reusedCodeError).toBeDefined();
  });
});
