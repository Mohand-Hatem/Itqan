import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { seed } from "./seed.js";
import { createTestClient } from "./test-client.js";

const db = createTestClient();
const tenantSlug = `seed-${randomUUID().slice(0, 8)}`;

afterAll(async () => {
  await db.tenant.deleteMany({ where: { slug: tenantSlug } });
  await db.$disconnect();
});

describe("seed (integration)", () => {
  it("creates the first tenant once, however many times it runs", async () => {
    const first = await seed(db, { tenantSlug, tenantName: "Seed Academy" });
    const second = await seed(db, { tenantSlug, tenantName: "Seed Academy" });

    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, tenantId: first.tenantId });
    expect(await db.tenant.count({ where: { slug: tenantSlug } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { tenantId: first.tenantId, action: "tenant.create" } }),
    ).toBe(1);
  });
});
