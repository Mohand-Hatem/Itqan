// Super admin management of a tenant's members (10R.5, FR-T02, docs/06 §11). The admin host has
// no tenant scope, so every query names the tenant explicitly.
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Prisma, PrismaClient } from "@itqan/database";
import {
  type AdminMember,
  type AdminMemberListQuery,
  type AdminMemberListResponse,
  type AdminMemberUpdate,
  ProvisioningReason,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { assertTeacherRemains } from "./last-teacher.js";

const memberInclude = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      emailVerified: true,
      mustChangePassword: true,
    },
  },
} satisfies Prisma.MembershipInclude;

type MemberRow = Prisma.MembershipGetPayload<{ include: typeof memberInclude }>;

const toMember = (m: MemberRow): AdminMember => ({
  membershipId: m.id,
  userId: m.user.id,
  name: m.user.name,
  email: m.user.email,
  role: m.role,
  status: m.status,
  userStatus: m.user.status,
  emailVerified: m.user.emailVerified,
  mustChangePassword: m.user.mustChangePassword,
  createdAt: m.createdAt.toISOString(),
});

@Injectable()
export class AdminMembersService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: AdminMemberListQuery): Promise<AdminMemberListResponse> {
    await this.requireTenant(tenantId);
    const rows = await this.db.membership
      .findMany({
        where: {
          tenantId,
          role: { in: query.role },
          ...(query.status ? { status: query.status } : {}),
          ...(query.q
            ? {
                user: {
                  OR: [
                    { name: { contains: query.q, mode: "insensitive" } },
                    { email: { contains: query.q, mode: "insensitive" } },
                  ],
                },
              }
            : {}),
        },
        take: query.limit + 1,
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: memberInclude,
      })
      .catch((err: unknown) => {
        if ((err as { code?: string })?.code === "P2025") {
          throw new BadRequestException({
            statusCode: 400,
            reason: "INVALID_CURSOR",
            message: "Cursor record not found.",
          });
        }
        throw err;
      });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toMember),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  /** Change role (teacher ⇄ assistant) and/or status. Never leaves a tenant without a teacher. */
  update(actorUserId: string, tenantId: string, membershipId: string, dto: AdminMemberUpdate) {
    return this.db.$transaction(async (tx) => {
      const member = await this.requireMember(tx, tenantId, membershipId);
      if (dto.role && member.role === "student") {
        throw new BadRequestException({
          statusCode: 400,
          reason: ProvisioningReason.NOT_STAFF,
          message: "A student membership keeps its role.",
        });
      }
      const stopsTeaching =
        member.role === "teacher" &&
        member.status === "active" &&
        ((dto.role !== undefined && dto.role !== "teacher") || dto.status === "suspended");
      if (stopsTeaching) await assertTeacherRemains(tx, [tenantId], { membershipId });

      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: { role: dto.role, status: dto.status },
        include: memberInclude,
      });
      await this.audit.record(
        {
          action: "member.update",
          targetType: "membership",
          targetId: membershipId,
          tenantId,
          actorUserId,
          meta: {
            userId: member.userId,
            from: { role: member.role, status: member.status },
            to: { role: updated.role, status: updated.status },
          },
        },
        tx,
      );
      return toMember(updated);
    });
  }

  /**
   * Remove a teacher or assistant from the tenant. Their staff sessions (which carry no tenant)
   * end only when this was their last staff role, so other tenants keep working (step 10.3 rule).
   */
  remove(actorUserId: string, tenantId: string, membershipId: string) {
    return this.db.$transaction(async (tx) => {
      const member = await this.requireMember(tx, tenantId, membershipId);
      if (member.role === "student") {
        throw new BadRequestException({
          statusCode: 400,
          reason: ProvisioningReason.NOT_STAFF,
          message: "Students are managed from the academy, not removed here.",
        });
      }
      if (member.role === "teacher" && member.status === "active") {
        await assertTeacherRemains(tx, [tenantId], { membershipId });
      }

      const staffElsewhere = await tx.membership.count({
        where: {
          userId: member.userId,
          id: { not: membershipId },
          role: { in: ["teacher", "assistant"] },
          status: "active",
        },
      });
      const { count: sessionsEnded } = await tx.session.deleteMany({
        where: {
          userId: member.userId,
          OR: [
            { tenantId },
            ...(staffElsewhere || member.user.isSuperAdmin ? [] : [{ tenantId: null }]),
          ],
        },
      });
      await tx.membership.delete({ where: { id: membershipId } });
      await this.audit.record(
        {
          action: "member.delete",
          targetType: "membership",
          targetId: membershipId,
          tenantId,
          actorUserId,
          meta: { userId: member.userId, role: member.role, sessionsEnded },
        },
        tx,
      );
      return { membershipId, deleted: true as const, sessionsEnded };
    });
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "TENANT_NOT_FOUND",
        message: "Tenant not found.",
      });
    }
  }

  private async requireMember(tx: Prisma.TransactionClient, tenantId: string, membershipId: string) {
    const member = await tx.membership.findFirst({
      where: { id: membershipId, tenantId },
      include: { user: { select: { isSuperAdmin: true } } },
    });
    if (!member) {
      throw new NotFoundException({
        statusCode: 404,
        reason: ProvisioningReason.MEMBER_NOT_FOUND,
        message: "Member not found in this tenant.",
      });
    }
    return member;
  }
}
