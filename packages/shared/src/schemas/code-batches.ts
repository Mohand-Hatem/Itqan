import { z } from "zod";

export const CodeBatchCreateSchema = z.object({
  courseId: z.string().uuid("Invalid course ID"),
  count: z
    .number()
    .int("Count must be an integer")
    .min(1, "At least 1 code must be generated")
    .max(500, "Cannot generate more than 500 codes per batch"),
  name: z.string().trim().max(100, "Name cannot exceed 100 characters").optional(),
});
export type CodeBatchCreateInput = z.infer<typeof CodeBatchCreateSchema>;

export const CodeBatchListQuerySchema = z.object({
  courseId: z.string().uuid("Invalid course ID").optional(),
  status: z.enum(["all", "active", "revoked"]).default("all").optional(),
  cursor: z.string().uuid("Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CodeBatchListQueryInput = z.infer<typeof CodeBatchListQuerySchema>;

export const CodeBatchCodesQuerySchema = z.object({
  status: z.enum(["all", "unredeemed", "redeemed", "revoked"]).default("all").optional(),
  cursor: z.string().uuid("Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CodeBatchCodesQueryInput = z.infer<typeof CodeBatchCodesQuerySchema>;
