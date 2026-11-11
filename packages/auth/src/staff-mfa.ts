import { systemPrisma } from "@itqan/database";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";

export const MFA_ENROLMENT_REQUIRED_REASON = "MFA_ENROLMENT_REQUIRED" as const;

export interface MfaStatus {
  mfaRequired: boolean;
  mfaEnrolled: boolean;
  enrolmentRequired: boolean;
  reason?: typeof MFA_ENROLMENT_REQUIRED_REASON;
}

/**
 * Checks whether a user is considered staff or platform super admin.
 * Per FR-A03: teachers, assistants, and super admins must use TOTP MFA.
 */
export async function isStaffOrSuperAdmin(
  userId: string,
  userHint?: { isSuperAdmin?: boolean | null }
): Promise<boolean> {
  if (userHint?.isSuperAdmin) {
    return true;
  }

  const dbUser = await systemPrisma.user.findUnique({
    where: { id: userId },
    select: {
      isSuperAdmin: true,
      memberships: {
        where: {
          status: "active",
          role: { in: ["teacher", "assistant"] },
        },
        select: { id: true },
      },
    },
  });

  if (!dbUser) return false;
  if (dbUser.isSuperAdmin) return true;
  return dbUser.memberships.length > 0;
}

/**
 * Evaluates whether MFA enrolment is required for a user.
 */
export async function checkStaffMfaRequirement(user: {
  id: string;
  isSuperAdmin?: boolean | null;
  twoFactorEnabled?: boolean | null;
}): Promise<MfaStatus> {
  const mfaRequired = await isStaffOrSuperAdmin(user.id, user);
  const mfaEnrolled = Boolean(user.twoFactorEnabled);
  const enrolmentRequired = mfaRequired && !mfaEnrolled;

  return {
    mfaRequired,
    mfaEnrolled,
    enrolmentRequired,
    reason: enrolmentRequired ? MFA_ENROLMENT_REQUIRED_REASON : undefined,
  };
}

/**
 * Better Auth plugin that enforces MFA enrolment policies for staff and super admins.
 * 1. Augments /sign-in/email responses with mfaEnrolmentRequired flag & reason when un-enrolled staff signs in.
 * 2. Exposes GET /mfa/status endpoint to check MFA requirement and enrolment state for the current session.
 */
export function staffMfaPlugin(): BetterAuthPlugin {
  return {
    id: "staff-mfa",
    endpoints: {
      getMfaStatus: createAuthEndpoint(
        "/mfa/status",
        {
          method: "GET",
        },
        async (ctx) => {
          const session = ctx.context.session;
          if (!session?.user) {
            return ctx.json(
              {
                mfaRequired: false,
                mfaEnrolled: false,
                enrolmentRequired: false,
              },
              { status: 200 }
            );
          }

          const status = await checkStaffMfaRequirement(session.user);
          return ctx.json(status, { status: 200 });
        }
      ),
    },
    hooks: {
      after: [
        {
          matcher: (context) => context.path === "/sign-in/email",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as
              | {
                  user?: {
                    id: string;
                    isSuperAdmin?: boolean;
                    twoFactorEnabled?: boolean;
                  };
                  token?: string;
                  twoFactorRedirect?: boolean;
                }
              | undefined;

            // If 2FA challenge is already triggered, Better Auth's twoFactor plugin handles it
            if (!returned || returned.twoFactorRedirect) {
              return;
            }

            if (returned.user) {
              const status = await checkStaffMfaRequirement(returned.user);
              if (status.enrolmentRequired) {
                return ctx.json({
                  ...returned,
                  mfaEnrolmentRequired: true,
                  reason: MFA_ENROLMENT_REQUIRED_REASON,
                });
              }
            }
          }),
        },
      ],
    },
  };
}
