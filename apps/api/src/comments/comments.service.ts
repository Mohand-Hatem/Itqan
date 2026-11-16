import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { getRequestContext, type Role, type ScopedPrismaClient } from "@itqan/database";
import type {
  CommentItemDto,
  CreateCommentDto,
  ListCommentsQueryDto,
  ListCommentsResponseDto,
  UpdateCommentDto,
} from "@itqan/shared";
import type { AuthUser } from "@itqan/auth";
import { AuditService } from "../audit/audit.service.js";
import { ContentAccessService } from "../content-items/content-access.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ContentAccessService) private readonly contentAccess: ContentAccessService,
  ) {}

  private getTenantId(): string {
    const context = getRequestContext();
    if (!context || context.kind !== "tenant") {
      throw new BadRequestException("No tenant context found");
    }
    return context.tenantId;
  }

  /**
   * Post a question or threaded reply on a lesson (content item).
   * Validates enrollment for students and parent comment validity for replies.
   */
  async create(
    actor: { userId: string; role: Role; membershipId: string; user: AuthUser },
    contentItemId: string,
    dto: CreateCommentDto,
  ): Promise<CommentItemDto> {
    const tenantId = this.getTenantId();

    const item = await this.db.contentItem.findUnique({
      where: { id: contentItemId },
      select: { id: true, courseId: true, deletedAt: true },
    });
    if (!item || item.deletedAt !== null) {
      throw new NotFoundException("Content item not found");
    }

    // Same gate as lesson content: enrolled, course not a draft, item and parents published (step 10.3).
    if (actor.role === "student") await this.contentAccess.studentItem(contentItemId, actor.user);

    if (dto.parentId) {
      const parent = await this.db.comment.findUnique({
        where: { id: dto.parentId },
        select: { id: true, contentItemId: true, deletedAt: true },
      });
      if (!parent || parent.deletedAt !== null || parent.contentItemId !== contentItemId) {
        throw new BadRequestException("Parent comment not found in this content item");
      }
    }

    const row = await this.db.comment.create({
      data: {
        tenantId,
        contentItemId,
        authorMembershipId: actor.membershipId,
        parentId: dto.parentId ?? null,
        body: dto.body,
      },
      include: {
        author: {
          select: {
            id: true,
            role: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      contentItemId: row.contentItemId,
      authorMembershipId: row.authorMembershipId,
      parentId: row.parentId,
      body: row.body,
      hiddenAt: row.hiddenAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      author: {
        membershipId: row.author.id,
        userId: row.author.user.id,
        name: row.author.user.name,
        role: row.author.role,
      },
    };
  }

  /**
   * Lists Q&A comments for a content item.
   * Students only see active, unhidden comments.
   * Staff see active comments including hidden ones.
   */
  async list(
    actor: { userId: string; role: Role; membershipId: string; user: AuthUser },
    contentItemId: string,
    query: ListCommentsQueryDto,
  ): Promise<ListCommentsResponseDto> {
    this.getTenantId(); // refuses the admin host (no tenant context)
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);

    const item = await this.db.contentItem.findUnique({
      where: { id: contentItemId },
      select: { id: true, courseId: true, deletedAt: true },
    });
    if (!item || item.deletedAt !== null) {
      throw new NotFoundException("Content item not found");
    }

    // Same gate as lesson content: enrolled, course not a draft, item and parents published (step 10.3).
    if (actor.role === "student") await this.contentAccess.studentItem(contentItemId, actor.user);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let where: any = {
      contentItemId,
      deletedAt: null,
      ...(actor.role === "student" ? { hiddenAt: null } : {}),
    };

    if (query.cursor) {
      const cursorRow = await this.db.comment.findUnique({
        where: { id: query.cursor },
        select: { id: true, createdAt: true },
      });

      if (cursorRow) {
        where = {
          AND: [
            where,
            {
              OR: [
                { createdAt: { gt: cursorRow.createdAt } },
                { createdAt: cursorRow.createdAt, id: { gt: cursorRow.id } },
              ],
            },
          ],
        };
      }
    }

    const rows = await this.db.comment.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: {
        author: {
          select: {
            id: true,
            role: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const nextItem = rows.pop()!;
      nextCursor = nextItem.id;
    }

    return {
      items: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        contentItemId: r.contentItemId,
        authorMembershipId: r.authorMembershipId,
        parentId: r.parentId,
        body: r.body,
        hiddenAt: r.hiddenAt,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        author: {
          membershipId: r.author.id,
          userId: r.author.user.id,
          name: r.author.user.name,
          role: r.author.role,
        },
      })),
      nextCursor,
    };
  }

  /**
   * Edit comment body (author only) or toggle hidden moderation status (staff only).
   */
  async update(
    actor: { userId: string; role: Role; membershipId: string; user: AuthUser },
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<CommentItemDto> {
    this.getTenantId();

    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      include: {
        author: {
          select: {
            id: true,
            role: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException("Comment not found");
    }

    if (dto.hidden !== undefined) {
      if (actor.role !== "teacher" && actor.role !== "assistant") {
        throw new ForbiddenException("Only staff can moderate comments");
      }

      await this.audit.record({
        action: dto.hidden ? "comment.hide" : "comment.unhide",
        targetType: "comment",
        targetId: comment.id,
        actorUserId: actor.userId,
        meta: {
          contentItemId: comment.contentItemId,
          authorMembershipId: comment.authorMembershipId,
        },
      });
    }

    if (dto.body !== undefined) {
      if (actor.membershipId !== comment.authorMembershipId) {
        throw new ForbiddenException("You can only edit your own comments");
      }
    }

    const updated = await this.db.comment.update({
      where: { id: commentId },
      data: {
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.hidden !== undefined ? { hiddenAt: dto.hidden ? new Date() : null } : {}),
      },
      include: {
        author: {
          select: {
            id: true,
            role: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      contentItemId: updated.contentItemId,
      authorMembershipId: updated.authorMembershipId,
      parentId: updated.parentId,
      body: updated.body,
      hiddenAt: updated.hiddenAt,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      author: {
        membershipId: updated.author.id,
        userId: updated.author.user.id,
        name: updated.author.user.name,
        role: updated.author.role,
      },
    };
  }

  /**
   * Soft-delete comment by author or staff.
   */
  async delete(
    actor: { userId: string; role: Role; membershipId: string; user: AuthUser },
    commentId: string,
  ): Promise<{ success: boolean }> {
    this.getTenantId();

    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      select: { id: true, authorMembershipId: true, contentItemId: true, deletedAt: true },
    });

    if (!comment || comment.deletedAt !== null) {
      throw new NotFoundException("Comment not found");
    }

    const isAuthor = actor.membershipId === comment.authorMembershipId;
    const isStaff = actor.role === "teacher" || actor.role === "assistant";

    if (!isAuthor && !isStaff) {
      throw new ForbiddenException("You cannot delete this comment");
    }

    if (!isAuthor && isStaff) {
      await this.audit.record({
        action: "comment.delete",
        targetType: "comment",
        targetId: comment.id,
        actorUserId: actor.userId,
        meta: {
          contentItemId: comment.contentItemId,
          authorMembershipId: comment.authorMembershipId,
        },
      });
    }

    await this.db.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }
}
