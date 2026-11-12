// Checks shared by student sign-in (5.3) and the device and sign-out requests (5.6, 5.7),
// so a blocked student and a student asking for help are judged the same way.
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";

type CredentialUser = { id: string; email: string; name: string; emailVerified: boolean };

/** The parts of Better Auth's context these checks use (endpoint ctx.context or auth.$context). */
export type PasswordContext<U extends CredentialUser = CredentialUser> = {
  internalAdapter: {
    findUserByEmail(
      email: string,
      options: { includeAccounts: boolean },
    ): Promise<{
      user: U;
      accounts: { providerId: string; accountId: string; password?: string | null }[];
    } | null>;
  };
  password: {
    hash(password: string): Promise<string>;
    verify(data: { hash: string; password: string }): Promise<boolean>;
  };
};

/** Better Auth's password check. Hashes anyway on a miss so timing does not reveal accounts. */
export async function verifyCredentials<U extends CredentialUser>(
  ctx: PasswordContext<U>,
  email: string,
  password: string,
): Promise<U | null> {
  const found = await ctx.internalAdapter.findUserByEmail(email.toLowerCase(), {
    includeAccounts: true,
  });
  const hash = found?.accounts.find(
    (a) => a.providerId === "credential" && a.accountId === found.user.id,
  )?.password;
  const ok = hash
    ? await ctx.password.verify({ hash, password })
    : (await ctx.password.hash(password), false);
  return found && ok ? found.user : null;
}

export type StudentAccess =
  { ok: true; membershipId: string } | { ok: false; code: AccessReasonCode; message: string };

/** docs/05-auth-devices.md §3 step 2–3: account, membership and tenant checks for a student. */
export async function checkStudentAccess(userId: string, tenantId: string): Promise<StudentAccess> {
  const record = await systemPrisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      status: true,
      isSuperAdmin: true,
      memberships: {
        where: { tenantId },
        select: { id: true, role: true, status: true, tenant: { select: { pausedRoles: true } } },
      },
    },
  });
  const no = (code: AccessReasonCode, message: string): StudentAccess => ({
    ok: false,
    code,
    message,
  });
  if (record.status === "suspended") {
    return no(AccessReasonCode.USER_SUSPENDED, "Your account is not active here.");
  }
  if (record.isSuperAdmin) return no(AccessReasonCode.USE_STAFF_SIGN_IN, "Use the staff sign-in.");
  const membership = record.memberships[0];
  if (!membership || membership.status !== "active") {
    return no(AccessReasonCode.NO_ACCESS, "Your account is not active here.");
  }
  if (membership.role !== "student") {
    return no(AccessReasonCode.USE_STAFF_SIGN_IN, "Use the staff sign-in.");
  }
  if (membership.tenant.pausedRoles.includes(membership.role)) {
    return no(AccessReasonCode.TENANT_PAUSED, "This platform is temporarily unavailable.");
  }
  return { ok: true, membershipId: membership.id };
}
