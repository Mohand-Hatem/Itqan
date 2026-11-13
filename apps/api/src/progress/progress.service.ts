import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { type LessonProgress, type ScopedPrismaClient } from "@itqan/database";
import {
  type CourseProgressResponse,
  type ItemProgress,
  ProgressReasonCode,
  type ProgressUpdateInput,
} from "@itqan/shared";
import { ContentAccessService } from "../content-items/content-access.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

const toResponse = (p: LessonProgress): ItemProgress => ({
  itemId: p.contentItemId,
  completed: p.completedAt !== null,
  completedAt: p.completedAt?.toISOString() ?? null,
  videoPositionSec: p.videoPositionSec,
  updatedAt: p.updatedAt.toISOString(),
});

const bad = (reason: string, message: string) =>
  new BadRequestException({ statusCode: 400, reason, message });

/** Student progress and resume point (step 7.10, FR-C07). The student comes from the session. */
@Injectable()
export class ProgressService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(ContentAccessService) private readonly access: ContentAccessService,
  ) {}

  async save(
    itemId: string,
    input: ProgressUpdateInput,
    user: AuthUser,
    membershipId: string,
  ): Promise<ItemProgress> {
    const item = await this.access.studentItem(itemId, user);
    if (item.kind !== "file" && item.kind !== "video") {
      throw bad(ProgressReasonCode.NOT_TRACKABLE, "Only files and videos track progress.");
    }
    if (input.videoPositionSec !== undefined && item.kind !== "video") {
      throw bad(ProgressReasonCode.NOT_A_VIDEO, "Only videos have a position.");
    }

    const key = { membershipId_contentItemId: { membershipId, contentItemId: itemId } };
    const existing = await this.db.lessonProgress.findUnique({ where: key });
    // Completing twice keeps the first time; false clears it; absent leaves it as it is.
    const completedAt =
      input.completed === undefined
        ? undefined
        : input.completed
          ? (existing?.completedAt ?? new Date())
          : null;
    const row = await this.db.lessonProgress.upsert({
      where: key,
      create: {
        tenantId: item.tenantId,
        membershipId,
        contentItemId: itemId,
        completedAt: completedAt ?? null,
        videoPositionSec: input.videoPositionSec ?? null,
      },
      update: { completedAt, videoPositionSec: input.videoPositionSec },
    });
    return toResponse(row);
  }

  async forCourse(
    courseId: string,
    user: AuthUser,
    membershipId: string,
  ): Promise<CourseProgressResponse> {
    await this.access.checkStudentCourse(courseId, user);
    const visible = await this.access.visibleItemIds(courseId);
    const rows = await this.db.lessonProgress.findMany({
      where: { membershipId, contentItem: { courseId } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    // Progress on items deleted or unpublished later is kept in the table but not shown.
    const items = rows.filter((r) => visible.has(r.contentItemId));
    const last = items.find((r) => r.completedAt === null);
    return {
      items: items.map(toResponse),
      resume: last ? { itemId: last.contentItemId, videoPositionSec: last.videoPositionSec } : null,
    };
  }
}
