import type { PrismaClient } from "./generated/prisma/client.js";

export type SeedOptions = { tenantSlug: string; tenantName: string };
export type SeedResult = { created: boolean; tenantId: string };

// Idempotent: creates the first tenant only if its slug is free. Pass the raw client
// (systemPrisma): seeding runs outside any request, so there is no tenant context.
// The super admin user and the tenant's teacher are added in step 4.1 (needs users table).
export async function seed(db: PrismaClient, options: SeedOptions): Promise<SeedResult> {
  const existing = await db.tenant.findUnique({ where: { slug: options.tenantSlug } });
  if (existing) return { created: false, tenantId: existing.id };

  // Tenant and its audit entry together: a crash cannot leave one without the other.
  const tenant = await db.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: { slug: options.tenantSlug, name: options.tenantName },
    });
    await tx.auditLog.create({
      data: {
        tenantId: created.id,
        action: "tenant.create",
        targetType: "tenant",
        targetId: created.id,
        meta: { source: "seed" },
      },
    });
    return created;
  });
  return { created: true, tenantId: tenant.id };
}
