import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import type { CourseCreateInput, CoursePatchInput, CourseQueryInput } from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

@Injectable()
export class CoursesService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(input: CourseCreateInput, actorUserId: string) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "No tenant context found in request",
      });
    }

    return this.db.$transaction(async (tx) => {
      const course = await tx.course.create({
        data: {
          tenantId,
          title: input.title,
          description: input.description ?? null,
          thumbnailAssetId: input.thumbnailAssetId ?? null,
          status: "draft",
        },
      });

      await this.audit.record(
        {
          action: "course.create",
          targetType: "course",
          targetId: course.id,
          actorUserId,
          meta: { title: course.title, status: course.status },
        },
        tx,
      );

      return course;
    });
  }

  async list(query: CourseQueryInput) {
    const rows = await this.db.course
      .findMany({
        where: {
          deletedAt: null,
          ...(query.status ? { status: query.status } : {}),
        },
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      })
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
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
      items: page,
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  async getById(id: string) {
    const course = await this.db.course.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });
    if (!course) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
    }
    return course;
  }

  async update(id: string, input: CoursePatchInput, actorUserId: string) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.course.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          reason: "COURSE_NOT_FOUND",
          message: "Course not found.",
        });
      }

      const updated = await tx.course.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.thumbnailAssetId !== undefined
            ? { thumbnailAssetId: input.thumbnailAssetId }
            : {}),
        },
      });

      await this.audit.record(
        {
          action: "course.update",
          targetType: "course",
          targetId: id,
          actorUserId,
          meta: {
            changes: {
              ...(input.title !== undefined && input.title !== existing.title
                ? { title: { from: existing.title, to: input.title } }
                : {}),
              ...(input.description !== undefined && input.description !== existing.description
                ? { description: { from: existing.description, to: input.description } }
                : {}),
              ...(input.thumbnailAssetId !== undefined && input.thumbnailAssetId !== existing.thumbnailAssetId
                ? { thumbnailAssetId: { from: existing.thumbnailAssetId, to: input.thumbnailAssetId } }
                : {}),
              ...(input.status !== undefined && input.status !== existing.status
                ? { status: { from: existing.status, to: input.status } }
                : {}),
            },
          },
        },
        tx,
      );

      return updated;
    });
  }

  async delete(id: string, actorUserId: string) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.course.findFirst({
        where: { id, deletedAt: null },
      });
      if (!existing) {
        throw new NotFoundException({
          statusCode: 404,
          reason: "COURSE_NOT_FOUND",
          message: "Course not found.",
        });
      }

      await tx.course.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await this.audit.record(
        {
          action: "course.delete",
          targetType: "course",
          targetId: id,
          actorUserId,
          meta: { title: existing.title },
        },
        tx,
      );

      return { id, deleted: true };
    });
  }
}
