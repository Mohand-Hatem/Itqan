import { z } from "zod";

export const CourseStatusSchema = z.enum(["draft", "published", "archived"]);
export type CourseStatus = z.infer<typeof CourseStatusSchema>;

export const CourseCreateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title cannot exceed 200 characters"),
  description: z.string().trim().max(5000, "Description cannot exceed 5000 characters").optional(),
  thumbnailAssetId: z.string().uuid("Invalid asset ID").optional(),
});
export type CourseCreateInput = z.infer<typeof CourseCreateSchema>;

export const CoursePatchSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required")
    .max(200, "Title cannot exceed 200 characters")
    .optional(),
  description: z.string().trim().max(5000, "Description cannot exceed 5000 characters").nullish(),
  status: CourseStatusSchema.optional(),
  thumbnailAssetId: z.string().uuid("Invalid asset ID").nullish(),
});
export type CoursePatchInput = z.infer<typeof CoursePatchSchema>;

export const CourseQuerySchema = z.object({
  status: CourseStatusSchema.optional(),
  cursor: z.string().uuid("Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CourseQueryInput = z.infer<typeof CourseQuerySchema>;
