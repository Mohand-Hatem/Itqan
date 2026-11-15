import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { getRequestContext, type Role, type ScopedPrismaClient } from "@itqan/database";
import type {
  AnnouncementDto,
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
  ListAnnouncementsResponseDto,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { SseService } from "../notifications/sse.service.js";

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    private readonly audit: AuditService,
    @Optional() private readonly sse?: SseService,
  ) {}

  private getTenantId(): string {
    const context = getRequestContext();
    if (!context || context.kind !== "tenant") {
      throw new BadRequestException("No tenant context found");
    }
    return context.tenantId;
  }

  /**
   * Publishes an announcement (tenant-wide or course-specific) by staff (teacher/assistant).
   * Generates in-app notifications for enrolled students and records an audit log.
   */
  async create(
    actor: { userId: string; role: Role },
    dto: CreateAnnouncementDto,
  ): Promise<AnnouncementDto> {
    const tenantId = this.getTenantId();

    if (dto.courseId) {
      const course = await this.db.course.findUnique({
        where: { id: dto.courseId },
        select: { id: true, title: true, deletedAt: true },
      });
      if (!course || course.deletedAt !== null) {
        throw new NotFoundException("Course not found");
      }
    }

    const { row, targetStudentUserIds, authorName, courseTitle } =
      await this.db.$transaction(async (tx) => {
        // 1. Create announcement row
        const row = await tx.announcement.create({
          data: {
            tenantId,
            courseId: dto.courseId ?? null,
            title: dto.title,
            body: dto.body,
            createdBy: actor.userId,
          },
          include: {
            author: { select: { name: true } },
            course: { select: { title: true } },
          },
        });

        // 2. Identify target student recipients
        let targetStudentUserIds: string[];
        if (!dto.courseId) {
          // Tenant-wide announcement: all active students in this tenant
          const memberships = await tx.membership.findMany({
            where: { tenantId, role: "student", status: "active" },
            select: { userId: true },
          });
          targetStudentUserIds = Array.from(new Set(memberships.map((m) => m.userId)));
        } else {
          // Course-specific announcement: all active enrollments for this course
          const enrollments = await tx.enrollment.findMany({
            where: { tenantId, courseId: dto.courseId, status: "active" },
            select: { membership: { select: { userId: true } } },
          });
          targetStudentUserIds = Array.from(new Set(enrollments.map((e) => e.membership.userId)));
        }

        // 3. Batch insert notifications for targeted students
        if (targetStudentUserIds.length > 0) {
          await tx.notification.createMany({
            data: targetStudentUserIds.map((userId) => ({
              tenantId,
              userId,
              type: "announcement",
              title: dto.title,
              body: dto.body.length > 120 ? `${dto.body.slice(0, 117)}...` : dto.body,
              data: {
                announcementId: row.id,
                courseId: dto.courseId ?? null,
                courseTitle: row.course?.title ?? null,
              },
            })),
          });
        }

        // 4. Record audit log
        await this.audit.record(
          {
            action: "announcement.create",
            targetType: "announcement",
            targetId: row.id,
            actorUserId: actor.userId,
            meta: {
              title: row.title,
              courseId: row.courseId,
              recipientCount: targetStudentUserIds.length,
            },
          },
          tx,
        );

        return {
          row,
          targetStudentUserIds,
          authorName: row.author.name,
          courseTitle: row.course?.title ?? null,
        };
      });

    // 5. Post-commit SSE emission
    if (this.sse) {
      for (const uid of targetStudentUserIds) {
        this.sse.emitToUser(
          uid,
          {
            event: "notification.created",
            data: {
              type: "announcement",
              title: row.title,
              body: row.body.length > 120 ? `${row.body.slice(0, 117)}...` : row.body,
              data: {
                announcementId: row.id,
                courseId: row.courseId,
                courseTitle,
              },
              createdAt: row.createdAt,
            },
          },
          tenantId,
        );
      }
    }

    return {
      id: row.id,
      tenantId: row.tenantId,
      courseId: row.courseId,
      title: row.title,
      body: row.body,
      publishedAt: row.publishedAt,
      createdBy: row.createdBy,
      authorName,
      courseTitle,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Lists announcements with keyset cursor pagination.
   * Staff can view all announcements or filter by course.
   * Students can only view tenant-wide announcements and announcements for courses they are enrolled in.
   */
  async list(
    actor: { userId: string; role: Role },
    query: ListAnnouncementsQueryDto,
  ): Promise<ListAnnouncementsResponseDto> {
    const tenantId = this.getTenantId();
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let where: any = {};

    if (actor.role === "student") {
      if (query.courseId) {
        // Verify student has an active enrollment in this specific course
        const enrollment = await this.db.enrollment.findFirst({
          where: {
            tenantId,
            courseId: query.courseId,
            membership: { userId: actor.userId },
            status: "active",
          },
          select: { id: true },
        });

        if (!enrollment) {
          throw new ForbiddenException("You are not enrolled in this course");
        }

        where = {
          courseId: query.courseId,
          course: { deletedAt: null },
        };
      } else {
        // Default student feed: tenant-wide announcements + announcements for enrolled active courses
        const enrollments = await this.db.enrollment.findMany({
          where: {
            tenantId,
            membership: { userId: actor.userId },
            status: "active",
          },
          select: { courseId: true },
        });
        const enrolledCourseIds = enrollments.map((e) => e.courseId);

        where = {
          OR: [
            { courseId: null },
            { courseId: { in: enrolledCourseIds }, course: { deletedAt: null } },
          ],
        };
      }
    } else {
      // Staff (teacher/assistant)
      if (query.courseId) {
        where = { courseId: query.courseId };
      }
    }

    if (query.cursor) {
      const cursorRow = await this.db.announcement.findUnique({
        where: { id: query.cursor },
        select: { id: true, publishedAt: true },
      });

      if (cursorRow) {
        where = {
          AND: [
            where,
            {
              OR: [
                { publishedAt: { lt: cursorRow.publishedAt } },
                { publishedAt: cursorRow.publishedAt, id: { lt: cursorRow.id } },
              ],
            },
          ],
        };
      }
    }

    const items = await this.db.announcement.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        author: { select: { name: true } },
        course: { select: { title: true } },
      },
    });

    let nextCursor: string | null = null;
    if (items.length > limit) {
      const nextItem = items.pop()!;
      nextCursor = nextItem.id;
    }

    return {
      items: items.map((a) => ({
        id: a.id,
        tenantId: a.tenantId,
        courseId: a.courseId,
        title: a.title,
        body: a.body,
        publishedAt: a.publishedAt,
        createdBy: a.createdBy,
        authorName: a.author.name,
        courseTitle: a.course?.title ?? null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
      nextCursor,
    };
  }
}
