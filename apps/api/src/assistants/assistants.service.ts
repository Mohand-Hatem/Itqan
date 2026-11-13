import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Auth } from "@itqan/auth";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import type {
  AssistantCreateDto,
  AssistantDeleteResponse,
  AssistantListItem,
  AssistantListQuery,
  AssistantListResponse,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { AUTH_INSTANCE } from "../auth/session.guard.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

@Injectable()
export class AssistantsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(AuditService) private readonly audit: AuditService,
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

  /** Provisions a new assistant or links an existing user as assistant. */
  async create(actorUserId: string, dto: AssistantCreateDto): Promise<AssistantListItem> {
    const tenantId = this.getTenantId();
    const email = dto.email.trim().toLowerCase();

    return this.db.$transaction(async (tx) => {
      // 1. Check if user already exists globally
      const existingUser = await tx.user.findUnique({
        where: { email },
      });

      let userId: string;
      let existingUserLinked = false;

      if (existingUser) {
        // 2. Check if user already has a membership on this tenant
        const existingMembership = await tx.membership.findFirst({
          where: { tenantId, userId: existingUser.id },
        });
        if (existingMembership) {
          throw new ConflictException({
            statusCode: 409,
            reason: "MEMBERSHIP_ALREADY_EXISTS",
            code: "MEMBERSHIP_ALREADY_EXISTS",
            message: "User already has a membership on this tenant",
          });
        }

        userId = existingUser.id;
        existingUserLinked = true;
      } else {
        // 3. User does not exist: create user and credential account
        const ctx = await this.auth.$context;
        const hashedPassword = await ctx.password.hash(dto.temporaryPassword);

        const newUser = await tx.user.create({
          data: {
            name: dto.name,
            email,
            emailVerified: true,
          },
        });

        await tx.account.create({
          data: {
            userId: newUser.id,
            accountId: newUser.id,
            providerId: "credential",
            password: hashedPassword,
          },
        });

        userId = newUser.id;
      }

      // 4. Create assistant membership
      const membership = await tx.membership.create({
        data: {
          tenantId,
          userId,
          role: "assistant",
          status: "active",
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // 5. Transactional audit log
      await this.audit.record(
        {
          action: "assistant.create",
          targetType: "membership",
          targetId: membership.id,
          actorUserId,
          meta: {
            userId,
            existingUserLinked,
          },
        },
        tx,
      );

      return {
        id: membership.id,
        userId: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: "assistant",
        createdAt: membership.createdAt.toISOString(),
        existingUserLinked,
      };
    });
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

      // Evict active sessions on this tenant (or untagged staff sessions)
      const { count: sessionsEnded } = await tx.session.deleteMany({
        where: {
          userId: membership.userId,
          OR: [{ tenantId }, { tenantId: null }],
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
