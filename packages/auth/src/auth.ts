import process from "node:process";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { systemPrisma } from "@itqan/database";
import { sendResetPasswordEmail, sendVerificationEmail } from "./email/client.js";
import { staffMfaPlugin } from "./staff-mfa.js";
import { guardStudentSession, studentSignInPlugin } from "./student-sign-in.js";

export const auth = betterAuth({
  appName: "Itqan",
  secret:
    process.env["BETTER_AUTH_SECRET"] || "development-secret-for-build-and-test-only-min-32-chars",
  baseURL: process.env["BETTER_AUTH_URL"] || "http://localhost:3000",
  trustedOrigins: [
    "http://localhost:3000",
    "http://localhost:8080",
    "http://*.localhost",
    "http://*.localhost:8080",
    "http://*.localhost:3000",
  ],
  database: prismaAdapter(systemPrisma, {
    provider: "postgresql",
    // Real transactions: the student login locks the user row until the session is written (ADR-011).
    transaction: true,
  }),
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          await guardStudentSession(session);
          return { data: session };
        },
      },
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
  emailVerification: {
    // Never log the link: it carries the token (CLAUDE.md "never log tokens").
    sendVerificationEmail: async ({ user, url, token }) => {
      await sendVerificationEmail({
        to: user.email,
        url,
        token,
        name: user.name,
      });
    },
    sendOnSignUp: true,
    // Off: students must sign in through /sign-in/student so the device rules run (ADR-011).
    autoSignInAfterVerification: false,
    expiresIn: 3600,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => {
      await sendResetPasswordEmail({
        to: user.email,
        url,
        token,
        name: user.name,
      });
    },
  },
  session: {
    expiresIn: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 1 day
    cookieCache: {
      enabled: false,
    },
    // Set only by our student sign-in (ADR-011), never from client input.
    additionalFields: {
      deviceId: {
        type: "string",
        required: false,
        input: false,
      },
      tenantId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": {
        window: 60,
        max: 5,
      },
      "/sign-in/student": {
        window: 60,
        max: 5,
      },
      "/request-password-reset": {
        window: 15 * 60,
        max: 3,
      },
      "/reset-password": {
        window: 15 * 60,
        max: 3,
      },
      "/send-verification-email": {
        window: 15 * 60,
        max: 3,
      },
      "/two-factor/*": {
        window: 60,
        max: 5,
      },
    },
  },
  user: {
    additionalFields: {
      maxDevices: {
        type: "number",
        required: false,
        defaultValue: 1,
        input: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "active",
        input: false,
      },
      isSuperAdmin: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  plugins: [
    twoFactor({
      issuer: "Itqan",
    }),
    staffMfaPlugin(),
    studentSignInPlugin(),
  ],
});

export type Auth = typeof auth;
export type SessionPayload = typeof auth.$Infer.Session;
export type AuthSession = typeof auth.$Infer.Session.session;
export type AuthUser = typeof auth.$Infer.Session.user;
