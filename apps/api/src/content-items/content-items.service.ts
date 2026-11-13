import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type ContentItem, getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import {
  type ContentItemCreateInput,
  type ContentItemPatchInput,
  type ContentItemResponse,
  type ContentKind,
  ContentReasonCode,
  type ContentTreeNode,
  isContainerKind,
  MAX_TREE_DEPTH,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { placeAt, planMove, subtreeIds } from "./tree.js";

type Tx = Pick<ScopedPrismaClient, "$queryRaw" | "contentItem" | "mediaAsset">;
type Row = Pick<
  ContentItem,
  "id" | "parentId" | "depth" | "kind" | "sortOrder" | "deletedAt" | "publishedAt"
>;

const toResponse = (c: ContentItem): ContentItemResponse => ({
  id: c.id,
  courseId: c.courseId,
  parentId: c.parentId,
  kind: c.kind,
  title: c.title,
  sortOrder: c.sortOrder,
  depth: c.depth,
  assetId: c.assetId,
  publishedAt: c.publishedAt?.toISOString() ?? null,
  deletedAt: c.deletedAt?.toISOString() ?? null,
});

const fail = (status: 400 | 404 | 409, reason: string, message: string) => {
  const body = { statusCode: status, reason, message };
  if (status === 400) return new BadRequestException(body);
  if (status === 404) return new NotFoundException(body);
  return new ConflictException(body);
};
const notFound = () =>
  fail(404, ContentReasonCode.CONTENT_ITEM_NOT_FOUND, "Content item not found.");
const courseNotFound = () => fail(404, "COURSE_NOT_FOUND", "Course not found.");

/** Live (not deleted) children of `parentId`, in their current order. */
const siblingsOf = (rows: readonly Row[], parentId: string | null) =>
  rows
    .filter((r) => r.parentId === parentId && !r.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

/** Course content tree (step 7.4, FR-C01/C02). Every change locks the course row first. */
@Injectable()
export class ContentItemsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(input: ContentItemCreateInput, actorUserId: string) {
    const tenantId = this.tenantId();
    return this.db.$transaction(async (tx) => {
      const rows = await this.lockAndLoad(tx, input.courseId);
      const parentId = input.parentId ?? null;
      const depth = parentId ? this.parentOf(rows, parentId).depth + 1 : 1;
      if (depth > MAX_TREE_DEPTH) {
        throw fail(409, ContentReasonCode.TREE_TOO_DEEP, "Courses go at most 5 levels deep.");
      }
      if (input.assetId) await this.checkAsset(tx, input.assetId, input.kind);

      const item = await tx.contentItem.create({
        data: {
          tenantId,
          courseId: input.courseId,
          parentId,
          kind: input.kind,
          title: input.title,
          depth,
          sortOrder: siblingsOf(rows, parentId).length,
          assetId: input.assetId ?? null,
        },
      });
      await this.audit.record(
        {
          action: "content.create",
          targetType: "content_item",
          targetId: item.id,
          actorUserId,
          meta: { courseId: item.courseId, kind: item.kind, title: item.title, parentId },
        },
        tx,
      );
      return toResponse(item);
    });
  }

  async update(id: string, input: ContentItemPatchInput, actorUserId: string) {
    const courseId = await this.courseOfLiveItem(id);
    return this.db.$transaction(async (tx) => {
      const rows = await this.lockAndLoad(tx, courseId);
      const item = rows.find((r) => r.id === id && !r.deletedAt);
      if (!item) throw notFound();

      const data: { title?: string; assetId?: string; publishedAt?: Date | null } = {};
      const audits: { action: string; meta: Record<string, unknown> }[] = [];

      if (input.title !== undefined) {
        data.title = input.title;
        audits.push({ action: "content.update", meta: { title: input.title } });
      }
      if (input.assetId !== undefined) {
        if (isContainerKind(item.kind)) {
          throw fail(400, ContentReasonCode.ASSET_NOT_USABLE, "Only files and videos hold a file.");
        }
        await this.checkAsset(tx, input.assetId, item.kind);
        data.assetId = input.assetId;
        audits.push({ action: "content.update", meta: { assetId: input.assetId } });
      }
      if (input.published !== undefined) {
        data.publishedAt = input.published ? (item.publishedAt ?? new Date()) : null;
        audits.push({ action: "content.publish", meta: { published: input.published } });
      }
      if (Object.keys(data).length > 0) await tx.contentItem.update({ where: { id }, data });

      if (input.parentId !== undefined || input.position !== undefined) {
        const target = input.parentId === undefined ? item.parentId : input.parentId;
        if (target !== item.parentId) {
          if (target) this.parentOf(rows, target);
          const plan = planMove(rows, id, target);
          if ("reason" in plan) {
            throw fail(
              409,
              plan.reason,
              plan.reason === ContentReasonCode.TREE_CYCLE
                ? "An item cannot move inside itself."
                : "Courses go at most 5 levels deep.",
            );
          }
          const delta = plan.depth - item.depth;
          if (delta !== 0) {
            await tx.contentItem.updateMany({
              where: { id: { in: subtreeIds(rows, id) } },
              data: { depth: { increment: delta } },
            });
          }
          await tx.contentItem.update({ where: { id }, data: { parentId: target } });
          await this.renumber(
            tx,
            siblingsOf(rows, item.parentId)
              .map((r) => r.id)
              .filter((s) => s !== id),
          );
        }
        await this.renumber(
          tx,
          placeAt(
            siblingsOf(rows, target).map((r) => r.id),
            id,
            input.position,
          ),
        );
        audits.push({
          action: "content.move",
          meta: { parentId: target, position: input.position ?? null },
        });
      }

      for (const a of audits) {
        await this.audit.record(
          { ...a, targetType: "content_item", targetId: id, actorUserId },
          tx,
        );
      }
      return toResponse(await tx.contentItem.findFirstOrThrow({ where: { id } }));
    });
  }

  /** Soft-deletes the item and everything under it, with one shared timestamp. */
  async remove(id: string, actorUserId: string) {
    const courseId = await this.courseOfLiveItem(id);
    return this.db.$transaction(async (tx) => {
      const rows = await this.lockAndLoad(tx, courseId);
      const item = rows.find((r) => r.id === id && !r.deletedAt);
      if (!item) throw notFound();

      const live = new Set(rows.filter((r) => !r.deletedAt).map((r) => r.id));
      const ids = subtreeIds(rows, id).filter((s) => live.has(s));
      await tx.contentItem.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      });
      await this.renumber(
        tx,
        siblingsOf(rows, item.parentId)
          .map((r) => r.id)
          .filter((s) => s !== id),
      );
      await this.audit.record(
        {
          action: "content.delete",
          targetType: "content_item",
          targetId: id,
          actorUserId,
          meta: { count: ids.length },
        },
        tx,
      );
      return toResponse(await tx.contentItem.findFirstOrThrow({ where: { id } }));
    });
  }

  /** Brings back what was deleted together with the item; it goes last among its siblings. */
  async restore(id: string, actorUserId: string) {
    const found = await this.db.contentItem.findFirst({ where: { id } });
    if (!found) throw notFound();
    if (!found.deletedAt) return toResponse(found);

    return this.db.$transaction(async (tx) => {
      const rows = await this.lockAndLoad(tx, found.courseId);
      const item = rows.find((r) => r.id === id)!;
      if (!item.deletedAt) {
        return toResponse(await tx.contentItem.findFirstOrThrow({ where: { id } }));
      }
      const parent = item.parentId ? rows.find((r) => r.id === item.parentId) : undefined;
      if (parent?.deletedAt) {
        throw fail(409, ContentReasonCode.PARENT_DELETED, "Restore the parent item first.");
      }

      const at = item.deletedAt.getTime();
      const deletedTogether = new Set(
        rows.filter((r) => r.deletedAt?.getTime() === at).map((r) => r.id),
      );
      const ids = subtreeIds(rows, id).filter((s) => deletedTogether.has(s));
      await tx.contentItem.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
      await tx.contentItem.update({
        where: { id },
        data: { sortOrder: siblingsOf(rows, item.parentId).length },
      });
      await this.audit.record(
        {
          action: "content.restore",
          targetType: "content_item",
          targetId: id,
          actorUserId,
          meta: { count: ids.length },
        },
        tx,
      );
      return toResponse(await tx.contentItem.findFirstOrThrow({ where: { id } }));
    });
  }

  /** Staff view: the live tree, or (deleted) the items that were deleted as a group's top. */
  async tree(
    courseId: string,
    deleted: boolean,
  ): Promise<ContentTreeNode[] | ContentItemResponse[]> {
    const course = await this.db.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw courseNotFound();
    const items = await this.db.contentItem.findMany({
      where: { courseId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    if (deleted) {
      return items
        .filter((i) => {
          const parentDeletedAt = i.parentId ? byId.get(i.parentId)?.deletedAt : null;
          return i.deletedAt && parentDeletedAt?.getTime() !== i.deletedAt.getTime();
        })
        .map(toResponse);
    }

    const nodes = new Map<string, ContentTreeNode>();
    for (const i of items) if (!i.deletedAt) nodes.set(i.id, { ...toResponse(i), children: [] });
    const roots: ContentTreeNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId) nodes.get(node.parentId)?.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  private tenantId() {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw fail(400, "TENANT_REQUIRED", "No tenant context found in request");
    }
    return ctx.tenantId;
  }

  private async courseOfLiveItem(id: string) {
    const item = await this.db.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { courseId: true },
    });
    if (!item) throw notFound();
    return item.courseId;
  }

  /** Locks the course row (one tree edit at a time per course) and loads all of its items. */
  private async lockAndLoad(tx: Tx, courseId: string): Promise<Row[]> {
    // Raw SQL is not tenant-scoped by the extension: tenant_id is filtered by hand.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM courses
      WHERE id = ${courseId}::uuid AND tenant_id = ${this.tenantId()}::uuid AND deleted_at IS NULL
      FOR UPDATE`;
    if (locked.length === 0) throw courseNotFound();
    return tx.contentItem.findMany({
      where: { courseId },
      select: {
        id: true,
        parentId: true,
        depth: true,
        kind: true,
        sortOrder: true,
        deletedAt: true,
        publishedAt: true,
      },
    });
  }

  /** A live folder, chapter or lecture of this course. */
  private parentOf(rows: readonly Row[], parentId: string) {
    const parent = rows.find((r) => r.id === parentId && !r.deletedAt);
    if (!parent || !isContainerKind(parent.kind)) {
      throw fail(
        400,
        ContentReasonCode.INVALID_PARENT,
        "The parent must be a folder, chapter or lecture of this course.",
      );
    }
    return parent;
  }

  /** A ready, private file of this tenant: MP4 for videos, any other allowed type for files. */
  private async checkAsset(tx: Tx, assetId: string, kind: ContentKind) {
    const asset = await tx.mediaAsset.findFirst({
      where: { id: assetId, status: "ready", purpose: "content" },
      select: { mimeType: true },
    });
    const fits = asset && (kind === "video") === (asset.mimeType === "video/mp4");
    if (!fits) {
      throw fail(
        400,
        ContentReasonCode.ASSET_NOT_USABLE,
        "Use an uploaded file of the right type for this item.",
      );
    }
  }

  private async renumber(tx: Tx, orderedIds: readonly string[]) {
    for (const [sortOrder, id] of orderedIds.entries()) {
      await tx.contentItem.update({ where: { id }, data: { sortOrder } });
    }
  }
}
