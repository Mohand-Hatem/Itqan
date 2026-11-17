import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@itqan/database";
import { ProvisioningReason } from "@itqan/shared";

/**
 * FR-T02, FR-T03 (10R.5): every tenant keeps at least one active teacher (membership active and
 * user active). Call inside the write's transaction, before the write. It locks the tenant rows
 * first (in id order, so global suspension cannot deadlock with a member change), so two parallel
 * requests cannot each remove "the other" teacher: the second waits, then counts again.
 */
export async function assertTeacherRemains(
  tx: Prisma.TransactionClient,
  tenantIds: string[],
  leaving: { membershipId?: string; userId?: string },
) {
  if (tenantIds.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "tenants" WHERE id = ANY(${tenantIds}::uuid[]) ORDER BY id FOR UPDATE`;
  for (const tenantId of tenantIds) {
    const others = await tx.membership.count({
      where: {
        tenantId,
        role: "teacher",
        status: "active",
        user: { status: "active" },
        ...(leaving.membershipId ? { id: { not: leaving.membershipId } } : {}),
        ...(leaving.userId ? { userId: { not: leaving.userId } } : {}),
      },
    });
    if (others === 0) {
      throw new ConflictException({
        statusCode: 409,
        reason: ProvisioningReason.LAST_TEACHER,
        message: "This academy needs at least one active teacher. Add the new teacher first.",
        tenantId,
      });
    }
  }
}
