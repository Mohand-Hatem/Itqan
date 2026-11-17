import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient, systemPrisma } from "@itqan/database";
import type {
  AssistantCreateDto,
  AssistantDeleteResponse,
  AssistantListItem,
  AssistantListQuery,
  AssistantListResponse,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { type ProvisionActor, ProvisioningService } from "../provisioning/provisioning.service.js";

@Injectable()
export class AssistantsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProvisioningService) private readonly provisioning: ProvisioningService,
  ) {}

  private getTenantId(): string {
    const context = getRequestContext();
    if (!context || context.kind !== "tenant") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "NO_TENANT_CONTEXT",
        code: "NO_TENANT_CONTEXT",
        message: "No tenant context found in request",
      });
    }
    return context.tenantId;
  }

  /**
   * Creates a new assistant account directly (10R.4, ADR-013): unverified, 12+ character password,
   * changed at first sign-in. An email that already has an account gets 409 USE_INVITATION.
   */
  async create(actor: ProvisionActor, dto: AssistantCreateDto): Promise<AssistantListItem> {
    const result = await this.provisioning.provision({
      tenantId: this.getTenantId(),
      actor,
      role: "assistant",
      email: dto.email,
      name: dto.name,
      password: dto.temporaryPassword,
      auditAction: "assistant.create",
    });
    const membership = await this.db.membership.findUniqueOrThrow({
      where: { id: result.membershipId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    return {
      id: membership.id,
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: "assistant",
      createdAt: membership.createdAt.toISOString(),
      existingUserLinked: result.existingUserLinked,
    };
  }

  /** Lists assistants on this tenant with cursor pagination. */
  async list(query: AssistantListQuery): Promise<AssistantListResponse> {
    const tenantId = this.getTenantId();
    const limit = query.limit ?? 50;

    const records = await this.db.membership
      .findMany({
        where: {
          tenantId,
          role: "assistant",
        },
        take: limit + 1,
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      })
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
          throw new BadRequestException({
            statusCode: 400,
            reason: "INVALID_CURSOR",
            code: "INVALID_CURSOR",
            message: "Cursor record not found.",
          });
        }
        throw err;
      });

    const hasNextPage = records.length > limit;
    const items = hasNextPage ? records.slice(0, limit) : records;
    const nextCursor = hasNextPage ? items[items.length - 1]!.id : null;

    return {
      items: items.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: "assistant",
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /** Permanently deletes an assistant membership and evicts tenant sessions. */
  async delete(actorUserId: string, membershipId: string): Promise<AssistantDeleteResponse> {
    const tenantId = this.getTenantId();

    return this.db.$transaction(async (tx) => {
      const membership = await tx.membership.findFirst({
        where: {
          id: membershipId,
          tenantId,
          role: "assistant",
        },
      });

      if (!membership) {
        throw new NotFoundException({
          statusCode: 404,
          reason: "ASSISTANT_NOT_FOUND",
          code: "ASSISTANT_NOT_FOUND",
          message: "Assistant membership not found on this tenant",
        });
      }

      // Staff sessions carry no tenant and serve every tenant the user is staff on, so they end
      // only when this was the user's last staff role (audit itqan-run-1). Access to this tenant
      // ends at once anyway: AccessGuard reloads the membership on every request.
      const staffElsewhere = await systemPrisma.membership.count({
        where: {
          userId: membership.userId,
          id: { not: membership.id },
          role: { in: ["teacher", "assistant"] },
          status: "active",
        },
      });
      const { isSuperAdmin } = await tx.user.findUniqueOrThrow({
        where: { id: membership.userId },
        select: { isSuperAdmin: true },
      });
      const { count: sessionsEnded } = await tx.session.deleteMany({
        where: {
          userId: membership.userId,
          OR: [{ tenantId }, ...(staffElsewhere || isSuperAdmin ? [] : [{ tenantId: null }])],
        },
      });

      // Permanently delete membership row
      await tx.membership.delete({
        where: { id: membership.id },
      });

      // Transactional audit log
      await this.audit.record(
        {
          action: "assistant.delete",
          targetType: "membership",
          targetId: membership.id,
          actorUserId,
          meta: {
            userId: membership.userId,
            sessionsEnded,
          },
        },
        tx,
      );

      return {
        id: membership.id,
        deleted: true,
        sessionsEnded,
      };
    });
  }
}
