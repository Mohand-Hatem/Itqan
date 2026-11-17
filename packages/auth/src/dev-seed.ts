// Development test accounts for Swagger and manual testing (10R.4). Never runs in production.
// Passwords come from the developer's .env (SEED_STAFF_PASSWORD, SEED_STUDENT_PASSWORD).
import { type Role, systemPrisma } from "@itqan/database";
import { PASSWORD_MIN_LENGTH } from "@itqan/shared";
import { auth } from "./auth.js";

/** Reserved `.test` addresses (RFC 2606), so no real mailbox can receive anything. */
export const DEV_ACCOUNTS: { email: string; name: string; role: Role | null }[] = [
  { email: "superadmin@itqan.test", name: "Dev Super Admin", role: null },
  { email: "teacher@itqan.test", name: "Dev Teacher", role: "teacher" },
  { email: "assistant@itqan.test", name: "Dev Assistant", role: "assistant" },
  { email: "student@itqan.test", name: "Dev Student", role: "student" },
];

export async function seedDevAccounts(opts: {
  tenantSlug: string;
  staffPassword: string;
  studentPassword: string;
  nodeEnv?: string;
}) {
  if ((opts.nodeEnv ?? process.env["NODE_ENV"]) === "production") {
    throw new Error("The dev seed never runs in production.");
  }
  if (opts.staffPassword.length < PASSWORD_MIN_LENGTH.staff) {
    throw new Error(`SEED_STAFF_PASSWORD needs ${PASSWORD_MIN_LENGTH.staff}+ characters.`);
  }
  if (opts.studentPassword.length < PASSWORD_MIN_LENGTH.student) {
    throw new Error(`SEED_STUDENT_PASSWORD needs ${PASSWORD_MIN_LENGTH.student}+ characters.`);
  }
  const tenant = await systemPrisma.tenant.findUnique({ where: { slug: opts.tenantSlug } });
  if (!tenant) throw new Error(`Tenant "${opts.tenantSlug}" not found: run npm run db:seed first.`);

  const ctx = await auth.$context;
  for (const a of DEV_ACCOUNTS) {
    const hash = await ctx.password.hash(a.role === "student" ? opts.studentPassword : opts.staffPassword);
    // Idempotent: running again resets the four accounts to a usable state.
    const user = await systemPrisma.user.upsert({
      where: { email: a.email },
      create: {
        email: a.email,
        name: a.name,
        emailVerified: true,
        isSuperAdmin: a.role === null,
      },
      update: { status: "active", emailVerified: true, mustChangePassword: false },
      select: { id: true },
    });
    const { count } = await systemPrisma.account.updateMany({
      where: { userId: user.id, providerId: "credential" },
      data: { password: hash },
    });
    if (count === 0) {
      await systemPrisma.account.create({
        data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash },
      });
    }
    if (a.role) {
      await systemPrisma.membership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        create: { tenantId: tenant.id, userId: user.id, role: a.role },
        update: { status: "active" },
      });
    }
  }
  return DEV_ACCOUNTS.map((a) => a.email);
}
