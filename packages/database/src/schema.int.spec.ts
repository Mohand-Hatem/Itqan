import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createTestClient } from "./test-client.js";

const db = createTestClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

// Unique slug per test so files running in parallel never collide.
async function createTenant(slug = `t-${randomUUID().slice(0, 8)}`) {
  const tenant = await db.tenant.create({ data: { slug, name: "Test tenant" } });
  tenantIds.push(tenant.id);
  return tenant;
}

async function createUser(email = `u-${randomUUID().slice(0, 8)}@example.com`) {
  const user = await db.user.create({ data: { email, name: "Test user" } });
  userIds.push(user.id);
  return user;
}

afterEach(async () => {
  // Cascades to memberships and audit logs.
  await db.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  await db.user.deleteMany({ where: { id: { in: userIds.splice(0) } } });
});
afterAll(() => db.$disconnect());

describe("base schema (integration)", () => {
  it("creates a tenant with its defaults", async () => {
    const tenant = await createTenant();
    expect(tenant.status).toBe("active");
    expect(tenant.pausedRoles).toEqual([]);
    expect(tenant.settings).toEqual({});
    expect(tenant.deletedAt).toBeNull();
  });

  it("rejects a duplicate tenant slug", async () => {
    const tenant = await createTenant();
    await expect(createTenant(tenant.slug)).rejects.toMatchObject({ code: "P2002" });
  });

  it("creates a user with domain defaults", async () => {
    const user = await createUser();
    expect(user.maxDevices).toBe(1);
    expect(user.status).toBe("active");
    expect(user.isSuperAdmin).toBe(false);
    expect(user.emailVerified).toBe(false);
  });

  it("creates a membership inside a tenant", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    const membership = await db.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "student" },
    });
    expect(membership.status).toBe("active");
  });

  it("rejects a membership without a valid user foreign key", async () => {
    const tenant = await createTenant();
    await expect(
      db.membership.create({
        data: { tenantId: tenant.id, userId: randomUUID(), role: "student" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("allows only one membership per user per tenant", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    const data = { tenantId: tenant.id, userId: user.id, role: "student" as const };
    await db.membership.create({ data });
    await expect(
      db.membership.create({ data: { ...data, role: "assistant" } }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("lets the same user join two tenants", async () => {
    const [a, b] = [await createTenant(), await createTenant()];
    const user = await createUser();
    await db.membership.create({ data: { tenantId: a.id, userId: user.id, role: "student" } });
    await db.membership.create({ data: { tenantId: b.id, userId: user.id, role: "student" } });
    expect(await db.membership.count({ where: { userId: user.id } })).toBe(2);
  });

  it("saves audit entries for a tenant and for the platform", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    const tenantEntry = await db.auditLog.create({
      data: { tenantId: tenant.id, actorUserId: user.id, action: "student.suspend" },
    });
    const platformEntry = await db.auditLog.create({ data: { action: "tenant.create" } });
    expect(tenantEntry.meta).toEqual({});
    expect(platformEntry.tenantId).toBeNull();
    await db.auditLog.delete({ where: { id: platformEntry.id } });
  });

  it("cascades user deletion to memberships, sessions, accounts, and twoFactors", async () => {
    const tenant = await createTenant();
    const user = await createUser();
    await db.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "student" },
    });
    await db.session.create({
      data: {
        userId: user.id,
        token: `tok-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    await db.account.create({
      data: {
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: "hashed_password_test",
      },
    });
    await db.twoFactor.create({
      data: {
        userId: user.id,
        secret: `sec-${randomUUID()}`,
        backupCodes: "code1,code2",
      },
    });

    expect(await db.membership.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.account.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.twoFactor.count({ where: { userId: user.id } })).toBe(1);

    await db.user.delete({ where: { id: user.id } });

    expect(await db.membership.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.account.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.twoFactor.count({ where: { userId: user.id } })).toBe(0);
  });
});
