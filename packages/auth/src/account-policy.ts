// Password rules, the first-login password change and the staff sign-in audit (10R.3).
// docs/05-auth-devices.md §1a, §1b, §8; ADR-012, ADR-013.
import { createTenantLookup, getRootDomain, systemPrisma } from "@itqan/database";
import { parseHost, PASSWORD_MIN_LENGTH, PASSWORD_TOO_SHORT } from "@itqan/shared";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { isStaffOrSuperAdmin } from "./staff.js";

const tenants = createTenantLookup(systemPrisma);

/** FR-A09: teachers, assistants and super admins need 12 characters, students 8. */
export async function requiredPasswordLength(userId: string): Promise<number> {
  return (await isStaffOrSuperAdmin(userId)) ? PASSWORD_MIN_LENGTH.staff : PASSWORD_MIN_LENGTH.student;
}

async function assertPasswordLength(userId: string, password: unknown) {
  if (typeof password !== "string") return; // Better Auth's own body check answers this.
  const min = await requiredPasswordLength(userId);
  if (password.length < min) {
    throw new APIError("BAD_REQUEST", {
      code: PASSWORD_TOO_SHORT,
      message: `Password must be at least ${min} characters.`,
    });
  }
}

/** Safe failure categories for the sign-in audit; never the password or the raw error. */
const SIGN_IN_FAILURE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "invalid_credentials",
  USE_STUDENT_SIGN_IN: "use_student_sign_in",
  USER_SUSPENDED: "suspended",
  EMAIL_NOT_VERIFIED: "pending",
};

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * FR-L01: one audit row per staff sign-in attempt. The account is the target: whoever typed the
 * password is not a proven actor, so `actorUserId` stays empty. The account id is stored only when
 * the account exists; the typed email of an unknown account is never stored (it could be a
 * mistyped password). The response to the client is not changed, so nothing tells an attacker
 * which emails exist.
 */
async function auditSignIn(ctx: HookCtx) {
  const returned = ctx.context.returned;
  const failed = !returned || isAPIError(returned);
  const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null;
  const accountId = !failed
    ? ((returned as { user?: { id?: string } }).user?.id ?? null)
    : email
      ? ((await systemPrisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? null)
      : null;
  const code = failed && isAPIError(returned) ? String(returned.body?.code ?? "") : "";
  const target = parseHost(ctx.headers?.get("host") ?? undefined, getRootDomain());
  const tenant = target.kind === "tenant" ? await tenants.findBySlug(target.slug) : null;
  await systemPrisma.auditLog.create({
    data: {
      tenantId: tenant?.id ?? null,
      actorUserId: null,
      action: failed ? "auth.sign_in.failure" : "auth.sign_in.success",
      targetType: "user",
      targetId: accountId,
      meta: failed ? { reason: SIGN_IN_FAILURE[code] ?? "other" } : {},
      ip: ctx.headers?.get("x-real-ip") ?? null,
      userAgent: ctx.headers?.get("user-agent") ?? null,
    },
  });
}

/**
 * After a successful change of a password that had to be changed (FR-A08): clear the flag and end
 * the user's other sessions, which were opened with the password someone else knew. The current
 * session stays, so a student keeps the session bound to their device.
 */
async function afterPasswordChange(ctx: HookCtx) {
  const returned = ctx.context.returned;
  if (!returned || isAPIError(returned)) return;
  const { user, token } = returned as { user?: { id?: string }; token?: string | null };
  if (!user?.id) return;
  const row = await systemPrisma.user.findUnique({
    where: { id: user.id },
    select: { mustChangePassword: true },
  });
  if (!row?.mustChangePassword) return;
  // With revokeOtherSessions Better Auth already replaced every session (token = the new one).
  const current = token ? null : (ctx.context.session ?? (await getSessionFromCtx(ctx)));
  await systemPrisma.$transaction([
    systemPrisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } }),
    ...(token
      ? []
      : [
          systemPrisma.session.deleteMany({
            where: { userId: user.id, ...(current ? { id: { not: current.session.id } } : {}) },
          }),
        ]),
  ]);
}

export function accountPolicyPlugin() {
  return {
    id: "account-policy",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/change-password",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (session) await assertPasswordLength(session.user.id, ctx.body?.newPassword);
          }),
        },
        {
          // The reset token is the only link to the user here (Better Auth stores it this way).
          matcher: (ctx) => ctx.path === "/reset-password",
          handler: createAuthMiddleware(async (ctx) => {
            const token = ctx.body?.token;
            if (typeof token !== "string") return;
            const found = await ctx.context.internalAdapter.findVerificationValue(
              `reset-password:${token}`,
            );
            if (found?.value) await assertPasswordLength(found.value, ctx.body?.newPassword);
          }),
        },
        {
          // An active account with an unproven address (made directly by staff) gets a
          // verification link only when it asks for one while signed in. Otherwise a stranger
          // could verify a mistyped address and then reset the password (docs/05 §1a). The answer
          // looks the same either way.
          matcher: (ctx) => ctx.path === "/send-verification-email",
          handler: createAuthMiddleware(async (ctx) => {
            const email = typeof ctx.body?.email === "string" ? ctx.body.email.toLowerCase() : null;
            if (!email) return;
            const user = await systemPrisma.user.findUnique({
              where: { email },
              select: { id: true, status: true, emailVerified: true },
            });
            if (!user || user.status !== "active" || user.emailVerified) return;
            const session = await getSessionFromCtx(ctx);
            if (session?.user.id !== user.id) return ctx.json({ status: true });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/change-password",
          handler: createAuthMiddleware(afterPasswordChange),
        },
        {
          matcher: (ctx) => ctx.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            try {
              await auditSignIn(ctx);
            } catch (error) {
              // A failed audit write must not change the sign-in answer; it is logged instead.
              ctx.context.logger.error("Staff sign-in audit failed", error);
            }
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}
