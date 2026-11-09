import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createTestClient } from "./test-client.js";

const db = createTestClient();
const tenantIds: string[] = [];

// Unique slug per test so files running in parallel never collide.
async function createTenant(slug = `t-${randomUUID().slice(0, 8)}`) {
  const tenant = await db.tenant.create({ data: { slug, name: "Test tenant" } });
  tenantIds.push(tenant.id);
  return tenant;
}

afterEach(async () => {
  // Cascades to memberships and audit logs.
  await db.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
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

  it("creates a membership inside a tenant", async () => {
    const tenant = await createTenant();
    const membership = await db.membership.create({
      data: { tenantId: tenant.id, userId: randomUUID(), role: "student" },
    });
    expect(membership.status).toBe("active");
  });

  it("allows only one membership per user per tenant", async () => {
    const tenant = await createTenant();
    const data = { tenantId: tenant.id, userId: randomUUID(), role: "student" as const };
    await db.membership.create({ data });
    await expect(
      db.membership.create({ data: { ...data, role: "assistant" } }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("lets the same user join two tenants", async () => {
    const [a, b] = [await createTenant(), await createTenant()];
    const userId = randomUUID();
    await db.membership.create({ data: { tenantId: a.id, userId, role: "student" } });
    await db.membership.create({ data: { tenantId: b.id, userId, role: "student" } });
    expect(await db.membership.count({ where: { userId } })).toBe(2);
  });

  it("saves audit entries for a tenant and for the platform", async () => {
    const tenant = await createTenant();
    const tenantEntry = await db.auditLog.create({
      data: { tenantId: tenant.id, actorUserId: randomUUID(), action: "student.suspend" },
    });
    const platformEntry = await db.auditLog.create({ data: { action: "tenant.create" } });
    expect(tenantEntry.meta).toEqual({});
    expect(platformEntry.tenantId).toBeNull();
    await db.auditLog.delete({ where: { id: platformEntry.id } });
  });
});
