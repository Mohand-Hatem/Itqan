// The only ways to create or recover a super admin (FR-A10, ADR-013, docs/05 §1c). Run from the
// server shell (bootstrap-cli.ts); no HTTP route reaches this. Shell and database access are the
// authorization.
import { type Prisma, systemPrisma } from "@itqan/database";
import { PASSWORD_MIN_LENGTH } from "@itqan/shared";
import { auth } from "./auth.js";

export class BootstrapError extends Error {}

function assertStaffPassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH.staff) {
    throw new BootstrapError(
      `The password must have at least ${PASSWORD_MIN_LENGTH.staff} characters.`,
    );
  }
}

type Tx = Prisma.TransactionClient;

/** Creates the first super admin. Refuses when any super admin exists. */
export async function bootstrapSuperAdmin(input: { email: string; name: string; password: string }) {
  assertStaffPassword(input.password);
  return systemPrisma.$transaction(async (tx) => {
    // Two bootstraps at once must not both see "no super admin yet".
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('itqan.super-admin-bootstrap'))`;
    if ((await tx.user.count({ where: { isSuperAdmin: true } })) > 0) {
      throw new BootstrapError(
        "A super admin already exists. Use --recover <email> to set a super admin's password.",
      );
    }
    return createSuperAdminIn(tx, input);
  });
}

/** The account itself; callers hold the bootstrap lock and checked that none exists. */
export async function createSuperAdminIn(
  tx: Tx,
  input: { email: string; name: string; password: string },
) {
  assertStaffPassword(input.password);
  const email = input.email.trim().toLowerCase();
  if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new BootstrapError("This email already has an account. Choose another email.");
  }
  const hash = await (await auth.$context).password.hash(input.password);
  const user = await tx.user.create({
    data: { email, name: input.name, emailVerified: false, status: "active", isSuperAdmin: true },
    select: { id: true },
  });
  await tx.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash },
  });
  await tx.auditLog.create({
    data: { action: "platform.super_admin_bootstrap", targetType: "user", targetId: user.id, meta: {} },
  });
  return { userId: user.id };
}

/** Sets a new password for an existing super admin and ends all of their sessions. */
export async function recoverSuperAdmin(input: { email: string; password: string }) {
  assertStaffPassword(input.password);
  const email = input.email.trim().toLowerCase();
  const hash = await (await auth.$context).password.hash(input.password);

  return systemPrisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true, isSuperAdmin: true },
    });
    if (!user?.isSuperAdmin) throw new BootstrapError("No super admin has this email.");
    const { count } = await tx.account.updateMany({
      where: { userId: user.id, providerId: "credential" },
      data: { password: hash },
    });
    if (count === 0) {
      await tx.account.create({
        data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash },
      });
    }
    await tx.user.update({
      where: { id: user.id },
      data: { mustChangePassword: false, status: "active" },
    });
    const { count: sessionsEnded } = await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({
      data: {
        action: "platform.super_admin_recover",
        targetType: "user",
        targetId: user.id,
        meta: { sessionsEnded },
      },
    });
    return { userId: user.id, sessionsEnded };
  });
}
