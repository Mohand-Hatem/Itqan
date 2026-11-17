import process from "node:process";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { openAPI } from "better-auth/plugins";
import { systemPrisma } from "@itqan/database";
import { sendResetPasswordEmail, sendVerificationEmail } from "./email/client.js";
import { accountPolicyPlugin } from "./account-policy.js";
import { resolveAuthSecret } from "./secrets.js";
import { guardNewSession, studentSignInPlugin } from "./student-sign-in.js";

/**
 * Better Auth routes the LMS does not use (ADR-012, docs/05 §1d). The HTTP router answers 404 and
 * the OpenAPI generator leaves them out; server-side `auth.api.*` calls (test fixtures) still work.
 * Sign-up is closed because accounts come only from invitations, codes, staff or bootstrap (FR-A05).
 */
export const DISABLED_AUTH_PATHS = [
  "/sign-up/email",
  "/sign-in/social",
  "/link-social",
  "/unlink-account",
  "/list-accounts",
  "/account-info",
  "/refresh-token",
  "/get-access-token",
  "/delete-user",
  "/delete-user/callback",
  "/change-email",
  "/update-session",
  "/verify-password",
];

export const auth = betterAuth({
  appName: "Itqan",
  secret: resolveAuthSecret(),
  disabledPaths: DISABLED_AUTH_PATHS,
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
    user: {
      create: {
        // Only Better Auth's own sign-up creates users through this hook (our code writes users
        // directly), and that is self-registration: it waits for the verification link (10R.3).
        before: async (user) => ({
          data: user.emailVerified ? user : { ...user, status: "pending" },
        }),
      },
    },
    session: {
      create: {
        before: async (session) => {
          await guardNewSession(session);
          return { data: session };
        },
      },
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
    // Rate limits key on X-Real-IP, which nginx overwrites with the address it saw (the visitor,
    // via CF-Connecting-IP in staging). A client-sent X-Forwarded-For is never trusted (step 10.3).
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
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
    // A self-registered account becomes usable once its mailbox is proven (10R.3). Never wakes
    // a suspended account.
    afterEmailVerification: async (user) => {
      await systemPrisma.user.updateMany({
        where: { id: user.id, status: "pending" },
        data: { status: "active" },
      });
    },
  },
  emailAndPassword: {
    enabled: true,
    // Off: it is one switch for everyone, but accounts created directly by staff may sign in
    // unverified. guardNewSession refuses `pending` accounts instead (ADR-013, docs/05 §1a).
    requireEmailVerification: false,
    // Sign-up (server-side only; the HTTP route is off) never opens a session: the new account is
    // `pending` until its email is verified.
    autoSignIn: false,
    resetPasswordTokenExpiresIn: 3600,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => {
      // FR-A02: an unproven address is not trusted with a reset link. The API answers the same
      // either way; such users ask the super admin (FR-A07).
      if (!user.emailVerified) return;
      await sendResetPasswordEmail({
        to: user.email,
        url,
        token,
        name: user.name,
      });
    },
    // The user chose this password, so the first-login change is done (FR-A08). Sessions are
    // already ended by revokeSessionsOnPasswordReset.
    onPasswordReset: async ({ user }) => {
      await systemPrisma.user.update({
        where: { id: user.id },
        data: { mustChangePassword: false },
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
      // Read by AccessGuard from the session user (FR-A08); never set from client input.
      mustChangePassword: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
      // Read by the guardian-consent gate (10R.7, FR-A06); set by our routes only.
      isMinor: {
        type: "boolean",
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  plugins: [
    studentSignInPlugin(),
    accountPolicyPlugin(),
    // Route description for `npm run openapi:export` (step 10.6). Development only: it adds a
    // public GET /open-api/generate-schema route, which production must not expose.
    ...(process.env["NODE_ENV"] === "production" ? [] : [openAPI({ disableDefaultReference: true })]),
  ],
});

export type Auth = typeof auth;
export type SessionPayload = typeof auth.$Infer.Session;
export type AuthSession = typeof auth.$Infer.Session.session;
export type AuthUser = typeof auth.$Infer.Session.user;
