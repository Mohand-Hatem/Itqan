import { randomUUID } from "node:crypto";
import {
  createTestClient,
  createTwoTenants,
  type FixtureTenant,
  type RequestContext,
  runWithContext,
  withTenantScope,
} from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditService } from "./audit.service.js";

const raw = createTestClient();
const scoped = withTenantScope(raw);
const audit = new AuditService(scoped);
const platformIds: string[] = [];
let a: FixtureTenant;
let b: FixtureTenant;
let cleanup: () => Promise<unknown>;

const inTenant = <T>(t: FixtureTenant, fn: () => Promise<T>) =>
  runWithContext(
    {
      kind: "tenant",
      tenantId: t.id,
      tenantSlug: t.slug,
      ip: "198.51.100.4",
      userAgent: "ua-test",
    },
    async () => await fn(),
  );
const asAdmin = <T>(fn: () => Promise<T>) =>
  runWithContext(
    { kind: "admin", ip: "198.51.100.9" } satisfies RequestContext,
    async () => await fn(),
  );

beforeAll(async () => {
  ({ a, b, cleanup } = await createTwoTenants(raw));
});

afterAll(async () => {
  await cleanup();
  // Platform entries have no tenant to cascade from.
  await raw.auditLog.deleteMany({ where: { id: { in: platformIds } } });
  await raw.user.deleteMany({ where: { email: { startsWith: "actor-" } } });
  await raw.$disconnect();
});

describe("AuditService (integration)", () => {
  it("records the tenant, ip and user agent from the request context", async () => {
    const actor = await raw.user.create({
      data: { email: `actor-${randomUUID()}@example.com`, name: "Actor" },
    });
    const actorUserId = actor.id;
    const entry = await inTenant(a, () =>
      audit.record({
        action: "device.revoke",
        targetType: "device",
        targetId: "d1",
        actorUserId,
        meta: { reason: "lost phone", secret: "s3cr3t" },
      }),
    );
    expect(entry).toMatchObject({
      tenantId: a.id,
      actorUserId,
      action: "device.revoke",
      ip: "198.51.100.4",
      userAgent: "ua-test",
      meta: { reason: "lost phone", secret: "[redacted]" },
    });
  });

  it("records platform actions from the super admin site without a tenant", async () => {
    const entry = await asAdmin(() => audit.record({ action: "tenant.pause" }));
    platformIds.push(entry.id);
    expect(entry.tenantId).toBeNull();
    expect(entry.ip).toBe("198.51.100.9");
  });

  it("writes nothing when the caller's transaction rolls back", async () => {
    const action = `rollback.${randomUUID()}`;
    await expect(
      inTenant(a, () =>
        scoped.$transaction(async (tx) => {
          await audit.record({ action }, tx);
          throw new Error("action failed");
        }),
      ),
    ).rejects.toThrow("action failed");
    expect(await raw.auditLog.count({ where: { action } })).toBe(0);
  });

  it("lists only the current tenant's entries, newest first", async () => {
    await inTenant(b, () => audit.record({ action: "b.only" }));
    const first = await inTenant(a, () => audit.record({ action: "list.first" }));
    const second = await inTenant(a, () => audit.record({ action: "list.second" }));

    const entries = await inTenant(a, () => audit.list());
    expect(entries.every((e) => e.tenantId === a.id)).toBe(true);
    expect(entries.map((e) => e.id).slice(0, 2)).toEqual([second.id, first.id]);

    const page2 = await inTenant(a, () => audit.list({ limit: 1, cursor: second.id }));
    expect(page2.map((e) => e.id)).toEqual([first.id]);
  });

  it("is insert-only: the database rejects updates, even raw SQL", async () => {
    const entry = await inTenant(a, () => audit.record({ action: "immutable" }));
    await expect(
      raw.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/insert-only/);
    expect((await raw.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe(
      "immutable",
    );
  });
});
