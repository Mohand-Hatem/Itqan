import { z } from "zod";

/** Deepest level of a course tree; items at the top are level 1 (FR-C01). */
export const MAX_TREE_DEPTH = 5;

export const ContentKindSchema = z.enum(["folder", "chapter", "lecture", "file", "video"]);
export type ContentKind = z.infer<typeof ContentKindSchema>;

/** Kinds that hold other items. file and video are leaves that point to a media asset. */
export const CONTAINER_KINDS: ReadonlySet<ContentKind> = new Set(["folder", "chapter", "lecture"]);
export const isContainerKind = (kind: ContentKind) => CONTAINER_KINDS.has(kind);

export const ContentReasonCode = {
  CONTENT_ITEM_NOT_FOUND: "CONTENT_ITEM_NOT_FOUND",
  /** The parent is missing, deleted, in another course, or a file/video. */
  INVALID_PARENT: "INVALID_PARENT",
  TREE_CYCLE: "TREE_CYCLE",
  TREE_TOO_DEEP: "TREE_TOO_DEEP",
  /** The asset is missing, not ready, public, or the wrong type for the item. */
  ASSET_NOT_USABLE: "ASSET_NOT_USABLE",
  PARENT_DELETED: "PARENT_DELETED",
  /** A student asked for a course that is still a draft. */
  COURSE_NOT_PUBLISHED: "COURSE_NOT_PUBLISHED",
} as const;
export type ContentReasonCode = (typeof ContentReasonCode)[keyof typeof ContentReasonCode];

const Title = z.string().trim().min(1).max(200);

export const ContentItemCreateSchema = z
  .object({
    courseId: z.string().uuid(),
    parentId: z.string().uuid().nullish(),
    kind: ContentKindSchema,
    title: Title,
    assetId: z.string().uuid().optional(),
  })
  .refine((v) => isContainerKind(v.kind) === (v.assetId === undefined), {
    message: "file and video items need an assetId; folders, chapters and lectures take none",
    path: ["assetId"],
  });
export type ContentItemCreateInput = z.infer<typeof ContentItemCreateSchema>;

export const ContentItemPatchSchema = z
  .object({
    title: Title.optional(),
    /** Move under this parent; null = top of the course. */
    parentId: z.string().uuid().nullable().optional(),
    /** Index among the new siblings; larger than the count means last. */
    position: z.number().int().min(0).optional(),
    published: z.boolean().optional(),
    assetId: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type ContentItemPatchInput = z.infer<typeof ContentItemPatchSchema>;

export const ContentTreeQuerySchema = z.object({
  deleted: z.enum(["true", "false"]).default("false"),
});

export type ContentItemResponse = {
  id: string;
  courseId: string;
  parentId: string | null;
  kind: ContentKind;
  title: string;
  sortOrder: number;
  depth: number;
  assetId: string | null;
  publishedAt: string | null;
  deletedAt: string | null;
};
export type ContentTreeNode = ContentItemResponse & { children: ContentTreeNode[] };

/** Student view of the tree (step 7.6): published items only, no internal fields. */
export type StudentTreeNode = {
  id: string;
  kind: ContentKind;
  title: string;
  /** Set for file and video items, so the page can pick an icon and a viewer. */
  mimeType: string | null;
  children: StudentTreeNode[];
};

/**
 * GET /content-items/:id/access (step 7.6). Links are short-lived: ask again when they expire.
 * PDF and images: viewUrl, plus downloadUrl when downloadable. DOCX/PPTX: downloadUrl only.
 * MP4: viewUrl (4 h) and the viewer's watermark, never a downloadUrl.
 */
export type ContentAccessResponse = {
  itemId: string;
  kind: "file" | "video";
  mimeType: string;
  fileName: string;
  fileSize: number;
  viewUrl: string | null;
  downloadUrl: string | null;
  expiresAt: string;
  watermark: { name: string; email: string } | null;
};
