import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import type { ScopedPrismaClient } from "@itqan/database";
import { type ContentAccessResponse, ContentReasonCode, type StudentTreeNode } from "@itqan/shared";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { EnrollmentsService } from "../enrollments/enrollments.service.js";
import {
  contentDisposition,
  PRESIGN_GET_DOC_SECONDS,
  PRESIGN_GET_VIDEO_SECONDS,
  StorageService,
} from "../storage/storage.service.js";

const VIDEO = "video/mp4";
// Browsers cannot show these: they are download-only, whatever the policy (FR-C04).
const DOWNLOAD_ONLY = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const notFound = () =>
  new NotFoundException({
    statusCode: 404,
    reason: ContentReasonCode.CONTENT_ITEM_NOT_FOUND,
    message: "Content item not found.",
  });

type Node = { id: string; parentId: string | null; publishedAt: Date | null };

/** True when the item and every item above it are published (deleted rows are not in `byId`). */
function visible(byId: ReadonlyMap<string, Node>, id: string): boolean {
  for (let node = byId.get(id); node; node = node.parentId ? byId.get(node.parentId) : undefined) {
    if (!node.publishedAt) return false;
    if (node.parentId && !byId.has(node.parentId)) return false; // parent deleted
  }
  return byId.has(id);
}

/** What students see of a course, and signed links to files (step 7.6, FR-C04/C05/C06). */
@Injectable()
export class ContentAccessService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(EnrollmentsService) private readonly enrollments: EnrollmentsService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /** Published items of a course the student is enrolled in, nested, in order. */
  async studentTree(courseId: string, user: AuthUser): Promise<StudentTreeNode[]> {
    await this.checkStudentCourse(courseId, user);
    const rows = await this.db.contentItem.findMany({
      where: { courseId, deletedAt: null, publishedAt: { not: null } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: { asset: { select: { mimeType: true } } },
    });
    const children = new Map<string | null, typeof rows>();
    for (const r of rows) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r]);
    // Built from the top down, so anything under an unpublished or deleted item is left out.
    const build = (parentId: string | null): StudentTreeNode[] =>
      (children.get(parentId) ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        mimeType: r.asset?.mimeType ?? null,
        children: build(r.id),
      }));
    return build(null);
  }

  /** Signed links for one file or video. Students: enrolled, course not draft, item visible. */
  async access(itemId: string, user: AuthUser, isStudent: boolean): Promise<ContentAccessResponse> {
    const item = await this.db.contentItem.findFirst({
      where: { id: itemId, deletedAt: null },
      include: { asset: true },
    });
    if (!item) throw notFound();
    if (isStudent) {
      await this.checkStudentCourse(item.courseId, user);
      if (!(await this.visibleItemIds(item.courseId)).has(item.id)) throw notFound();
    }
    const asset = item.asset;
    if (!asset || asset.status !== "ready" || (item.kind !== "file" && item.kind !== "video")) {
      throw notFound();
    }

    const isVideo = asset.mimeType === VIDEO;
    const expiresIn = isVideo ? PRESIGN_GET_VIDEO_SECONDS : PRESIGN_GET_DOC_SECONDS;
    const link = (disposition: "inline" | "attachment") =>
      this.storage.presignGet("private", asset.storageKey, {
        expiresIn,
        contentType: asset.mimeType,
        disposition: contentDisposition(disposition, asset.originalName),
      });

    const downloadOnly = DOWNLOAD_ONLY.has(asset.mimeType);
    const view = downloadOnly ? null : await link("inline");
    const download =
      downloadOnly || (!isVideo && asset.downloadPolicy === "downloadable")
        ? await link("attachment")
        : null;

    return {
      itemId: item.id,
      kind: item.kind,
      mimeType: asset.mimeType,
      fileName: asset.originalName,
      fileSize: Number(asset.fileSize),
      viewUrl: view?.url ?? null,
      downloadUrl: download?.url ?? null,
      expiresAt: (view ?? download)!.expiresAt.toISOString(),
      watermark: isVideo ? { name: user.name, email: user.email } : null,
    };
  }

  /** A live item the student may see (enrolled, course not draft, visible), or 403/404. */
  async studentItem(itemId: string, user: AuthUser) {
    const item = await this.db.contentItem.findFirst({ where: { id: itemId, deletedAt: null } });
    if (!item) throw notFound();
    await this.checkStudentCourse(item.courseId, user);
    if (!(await this.visibleItemIds(item.courseId)).has(item.id)) throw notFound();
    return item;
  }

  /** Ids of the course's items that students see: published, under published parents. */
  async visibleItemIds(courseId: string): Promise<Set<string>> {
    const rows = await this.db.contentItem.findMany({
      where: { courseId, deletedAt: null },
      select: { id: true, parentId: true, publishedAt: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return new Set(rows.filter((r) => visible(byId, r.id)).map((r) => r.id));
  }

  /** Enrollment checks from step 6.7 (404/403 reasons), then: drafts are closed to students. */
  async checkStudentCourse(courseId: string, user: AuthUser) {
    await this.enrollments.checkAccess(courseId, user);
    const course = await this.db.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { status: true },
    });
    if (course?.status === "draft") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: ContentReasonCode.COURSE_NOT_PUBLISHED,
        message: "This course is not open yet.",
      });
    }
  }
}
