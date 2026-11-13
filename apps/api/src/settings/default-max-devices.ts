import type { PrismaClient } from "@itqan/database";
import { readTenantSettings } from "@itqan/shared";

/** Device limit for a brand-new student account joining this tenant (step 7.11, FR-T06). */
export async function defaultMaxDevices(db: Pick<PrismaClient, "tenant">, tenantId: string) {
  const { settings } = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { settings: true },
  });
  return readTenantSettings(settings).defaultMaxDevices;
}
