import { z } from "zod";

export const CreateCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment body is required").max(5000),
  parentId: z.string().uuid("Invalid parent comment ID").optional().nullable(),
});

export type CreateCommentDto = z.infer<typeof CreateCommentSchema>;

export const UpdateCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment body is required").max(5000).optional(),
  hidden: z.boolean().optional(),
});

export type UpdateCommentDto = z.infer<typeof UpdateCommentSchema>;

export const ListCommentsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListCommentsQueryDto = z.infer<typeof ListCommentsQuerySchema>;

export const CommentAuthorSchema = z.object({
  membershipId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  role: z.enum(["teacher", "assistant", "student"]),
});

export type CommentAuthorDto = z.infer<typeof CommentAuthorSchema>;

export const CommentItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  contentItemId: z.string().uuid(),
  authorMembershipId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  body: z.string(),
  hiddenAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  author: CommentAuthorSchema,
});

export type CommentItemDto = z.infer<typeof CommentItemSchema>;

export const ListCommentsResponseSchema = z.object({
  items: z.array(CommentItemSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type ListCommentsResponseDto = z.infer<typeof ListCommentsResponseSchema>;
