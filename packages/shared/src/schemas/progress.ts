import { z } from "zod";

/** Longest video position we accept, in seconds (24 h). */
export const MAX_VIDEO_POSITION_SEC = 24 * 60 * 60;

/** PUT /progress/:itemId (step 7.10, FR-C07). */
export const ProgressUpdateSchema = z
  .object({
    completed: z.boolean().optional(),
    videoPositionSec: z.number().int().min(0).max(MAX_VIDEO_POSITION_SEC).optional(),
  })
  .strict()
  .refine((v) => v.completed !== undefined || v.videoPositionSec !== undefined, "Nothing to save");
export type ProgressUpdateInput = z.infer<typeof ProgressUpdateSchema>;

export const ProgressReasonCode = {
  /** videoPositionSec was sent for an item that is not a video. */
  NOT_A_VIDEO: "NOT_A_VIDEO",
  /** Only file and video items can be completed. */
  NOT_TRACKABLE: "NOT_TRACKABLE",
} as const;

export type ItemProgress = {
  itemId: string;
  completed: boolean;
  completedAt: string | null;
  videoPositionSec: number | null;
  updatedAt: string;
};

/** GET /courses/:id/progress: resume = most recently touched visible item not yet completed. */
export type CourseProgressResponse = {
  items: ItemProgress[];
  resume: { itemId: string; videoPositionSec: number | null } | null;
};
