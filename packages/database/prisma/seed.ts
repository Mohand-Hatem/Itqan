// Run with `npm run db:seed` (Prisma loads the root .env through prisma7.config.ts).
import { systemPrisma } from "../src/client.js";
import { seed } from "../src/seed.js";

const tenantSlug = process.env["SEED_TENANT_SLUG"] || "demo";
const tenantName = process.env["SEED_TENANT_NAME"] || "Demo Academy";

try {
  const result = await seed(systemPrisma, { tenantSlug, tenantName });
  console.log(
    result.created
      ? `Seed: created tenant "${tenantSlug}" (${result.tenantId}).`
      : `Seed: tenant "${tenantSlug}" already exists (${result.tenantId}), nothing to do.`,
  );
} finally {
  await systemPrisma.$disconnect();
}
