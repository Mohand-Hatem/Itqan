// 10R.4 (FR-A10): super admins come only from the bootstrap command; recovery resets one.
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, describe, expect, it } from "vitest";
import {
  BootstrapError,
  bootstrapSuperAdmin,
  createSuperAdminIn,
  recoverSuperAdmin,
} from "./bootstrap.js";
import { auth, DEV_ACCOUNTS, seedDevAccounts } from "./index.js";

const emails: string[] = [];
const email = () => {
  const e = `boot-${randomUUID().slice(0, 8)}@example.com`;
  emails.push(e);
  return e;
};
const PASSWORD = "BootstrapPassword1";

afterAll(async () => {
  const users = await systemPrisma.user.findMany({
    where: { email: { in: [...emails, ...DEV_ACCOUNTS.map((a) => a.email)] } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await systemPrisma.auditLog.deleteMany({ where: { targetId: { in: ids } } });
  await systemPrisma.user.deleteMany({ where: { id: { in: ids } } });
  await systemPrisma.tenant.deleteMany({ where: { slug: { startsWith: "seed-test-" } } });
  await systemPrisma.$disconnect();
});

describe("super admin bootstrap (FR-A10)", () => {
  it("creates a super admin account with an audit row and no password in it", async () => {
    const address = email();
    const { userId } = await systemPrisma.$transaction((tx) =>
      createSuperAdminIn(tx, { email: address, name: "Owner", password: PASSWORD }),
    );
    const user = await systemPrisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ isSuperAdmin: true, status: "active", mustChangePassword: false });
    const audit = await systemPrisma.auditLog.findFirstOrThrow({
      where: { action: "platform.super_admin_bootstrap", targetId: userId },
    });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    await expect(auth.api.signInEmail({ body: { email: address, password: PASSWORD } })).resolves.toMatchObject({
      user: { id: userId },
    });
  });

  it("refuses a second run while any super admin exists, and short passwords", async () => {
    await systemPrisma.$transaction((tx) =>
      createSuperAdminIn(tx, { email: email(), name: "First", password: PASSWORD }),
    );
    await expect(
      bootstrapSuperAdmin({ email: email(), name: "Second", password: PASSWORD }),
    ).rejects.toThrow(/already exists/);
    await expect(
      bootstrapSuperAdmin({ email: email(), name: "Short", password: "Elevenchar1" }),
    ).rejects.toBeInstanceOf(BootstrapError);
  });

  it("recovers a super admin: new password, every session ended; refuses other accounts", async () => {
    const address = email();
    await systemPrisma.$transaction((tx) =>
      createSuperAdminIn(tx, { email: address, name: "Owner", password: PASSWORD }),
    );
    await auth.api.signInEmail({ body: { email: address, password: PASSWORD } });

    const { userId, sessionsEnded } = await recoverSuperAdmin({
      email: address,
      password: "RecoveredPassword1",
    });
    expect(sessionsEnded).toBe(1);
    await expect(
      auth.api.signInEmail({ body: { email: address, password: "RecoveredPassword1" } }),
    ).resolves.toMatchObject({ user: { id: userId } });

    const plain = email();
    await systemPrisma.user.create({ data: { email: plain, name: "Not an admin" } });
    await expect(recoverSuperAdmin({ email: plain, password: PASSWORD })).rejects.toThrow(
      /No super admin/,
    );
  });
});

describe("development seed (10R.4)", () => {
  it("refuses production and creates the four test accounts idempotently", async () => {
    const tenant = await systemPrisma.tenant.create({
      data: { slug: `seed-test-${randomUUID().slice(0, 6)}`, name: "Seed Test" },
    });
    const opts = {
      tenantSlug: tenant.slug,
      staffPassword: "SeedStaffPassword1",
      studentPassword: "Student8",
    };
    await expect(seedDevAccounts({ ...opts, nodeEnv: "production" })).rejects.toThrow(/production/);

    await seedDevAccounts(opts);
    await seedDevAccounts(opts);

    const users = await systemPrisma.user.findMany({
      where: { email: { in: DEV_ACCOUNTS.map((a) => a.email) } },
      include: { memberships: { where: { tenantId: tenant.id } } },
    });
    expect(users).toHaveLength(4);
    expect(users.flatMap((u) => u.memberships.map((m) => m.role)).sort()).toEqual([
      "assistant",
      "student",
      "teacher",
    ]);
    await expect(
      auth.api.signInEmail({ body: { email: "teacher@itqan.test", password: "SeedStaffPassword1" } }),
    ).resolves.toMatchObject({ user: { email: "teacher@itqan.test" } });
  });
});
