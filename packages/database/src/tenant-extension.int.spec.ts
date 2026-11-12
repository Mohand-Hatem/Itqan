import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithContext, type RequestContext } from "./context.js";
import { withTenantScope } from "./tenant-extension.js";
import { createTestClient } from "./test-client.js";

const raw = createTestClient();
const db = withTenantScope(raw);
let a: { id: string; slug: string };
let b: { id: string; slug: string };
let rowB: { id: string };

const asTenant = (t: { id: string; slug: string }): RequestContext => ({
  kind: "tenant",
  tenantId: t.id,
  tenantSlug: t.slug,
});
// Prisma queries run when awaited, so the await must happen inside the context.
const inA = <T>(fn: () => Promise<T>) => runWithContext(asTenant(a), async () => await fn());

const userIds: string[] = [];

beforeAll(async () => {
  const slug = () => `t-${randomUUID().slice(0, 8)}`;
  a = await raw.tenant.create({ data: { slug: slug(), name: "A" } });
  b = await raw.tenant.create({ data: { slug: slug(), name: "B" } });
  const userA = await raw.user.create({
    data: { email: `a-${randomUUID()}@example.com`, name: "A" },
  });
  const userB = await raw.user.create({
    data: { email: `b-${randomUUID()}@example.com`, name: "B" },
  });
  userIds.push(userA.id, userB.id);
  await raw.membership.create({ data: { tenantId: a.id, userId: userA.id, role: "student" } });
  rowB = await raw.membership.create({
    data: { tenantId: b.id, userId: userB.id, role: "student" },
  });
});

afterAll(async () => {
  await raw.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  await raw.user.deleteMany({ where: { id: { in: userIds } } });
  await raw.$disconnect();
});

describe("tenant extension against the database (integration)", () => {
  it("reads only the current tenant's rows", async () => {
    const rows = await inA(() => db.membership.findMany({ where: { tenantId: undefined } }));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === a.id)).toBe(true);
    expect(await inA(() => db.membership.count())).toBe(rows.length);
  });

  it("still scopes queries inside an interactive transaction", async () => {
    const [rows, other] = await inA(() =>
      db.$transaction(async (tx) => [
        await tx.membership.findMany(),
        await tx.membership.findUnique({ where: { id: rowB.id } }),
      ]),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === a.id)).toBe(true);
    expect(other).toBeNull();
  });

  it("cannot read another tenant's row even by its id", async () => {
    expect(await inA(() => db.membership.findUnique({ where: { id: rowB.id } }))).toBeNull();
  });

  it("sets tenantId on create from the context", async () => {
    const user = await raw.user.create({
      data: { email: `u-${randomUUID()}@example.com`, name: "U" },
    });
    userIds.push(user.id);
    const created = await inA(() =>
      db.membership.create({ data: { userId: user.id, role: "assistant" } as never }),
    );
    expect(created.tenantId).toBe(a.id);
  });

  it("cannot update or delete another tenant's row", async () => {
    const updated = await inA(() =>
      db.membership.updateMany({ where: { id: rowB.id }, data: { phone: "hacked" } }),
    );
    const deleted = await inA(() => db.membership.deleteMany({ where: { id: rowB.id } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    await expect(
      inA(() => db.membership.update({ where: { id: rowB.id }, data: { phone: "hacked" } })),
    ).rejects.toMatchObject({ code: "P2025" });
    expect((await raw.membership.findUniqueOrThrow({ where: { id: rowB.id } })).phone).toBeNull();
  });

  it("rejects a create for another tenant", async () => {
    await expect(
      inA(() =>
        db.membership.create({ data: { tenantId: b.id, userId: randomUUID(), role: "student" } }),
      ),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  it("refuses tenant tables outside a request", async () => {
    await expect(db.membership.findMany()).rejects.toMatchObject({ code: "NO_TENANT_CONTEXT" });
  });

  it("lets the super admin context see every tenant", async () => {
    const tenants = await runWithContext(
      { kind: "admin" },
      async () =>
        await db.membership.findMany({
          where: { tenantId: { in: [a.id, b.id] } },
          select: { tenantId: true },
        }),
    );
    expect(new Set(tenants.map((t) => t.tenantId))).toEqual(new Set([a.id, b.id]));
  });
});
