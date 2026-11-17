import { systemPrisma } from "@itqan/database";

/**
 * True for a platform super admin or a user with an active teacher or assistant membership
 * anywhere. Staff sign in at /sign-in/email and have no device rules (FR-D08).
 */
export async function isStaffOrSuperAdmin(
  userId: string,
  userHint?: { isSuperAdmin?: boolean | null },
): Promise<boolean> {
  if (userHint?.isSuperAdmin) return true;

  const dbUser = await systemPrisma.user.findUnique({
    where: { id: userId },
    select: {
      isSuperAdmin: true,
      memberships: {
        where: { status: "active", role: { in: ["teacher", "assistant"] } },
        select: { id: true },
      },
    },
  });

  if (!dbUser) return false;
  return dbUser.isSuperAdmin || dbUser.memberships.length > 0;
}
