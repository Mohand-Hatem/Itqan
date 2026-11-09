import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { TENANT_MODELS } from "../tenant-extension.js";

type MakeRow = (db: PrismaClient, tenantId: string) => Promise<{ id: string }>;

// One "make a row" function per tenant-owned model. Adding a tenant table means adding
// an entry here; isolation.int.spec.ts fails until you do, then sweeps the new table.
export const TENANT_FIXTURES: Record<string, MakeRow> = {
  Membership: (db, tenantId) =>
    db.membership.create({ data: { tenantId, userId: randomUUID(), role: "student" } }),
  AuditLog: (db, tenantId) => db.auditLog.create({ data: { tenantId, action: "test.fixture" } }),
};

export type FixtureTenant = {
  id: string;
  slug: string;
  /** Model name → id of this tenant's fixture row. */
  rows: Record<string, string>;
};

async function createFixtureTenant(db: PrismaClient, label: string): Promise<FixtureTenant> {
  const slug = `t-${label}-${randomUUID().slice(0, 8)}`;
  const tenant = await db.tenant.create({ data: { slug, name: `Tenant ${label}` } });
  const rows: Record<string, string> = {};
  for (const model of TENANT_MODELS) {
    const make = TENANT_FIXTURES[model];
    if (!make) throw new Error(`No isolation fixture for ${model}. Add one to TENANT_FIXTURES.`);
    rows[model] = (await make(db, tenant.id)).id;
  }
  return { id: tenant.id, slug: tenant.slug, rows };
}

// Two tenants with one row in every tenant-owned table. Pass the raw (unscoped) test client.
export async function createTwoTenants(db: PrismaClient) {
  const a = await createFixtureTenant(db, "a");
  const b = await createFixtureTenant(db, "b");
  return {
    a,
    b,
    // Deleting the tenants cascades to all their rows.
    cleanup: () => db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } }),
  };
}
