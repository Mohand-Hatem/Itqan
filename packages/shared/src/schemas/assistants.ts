import { z } from "zod";

export const AssistantCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  temporaryPassword: z.string().min(8).max(100),
});
export type AssistantCreateDto = z.infer<typeof AssistantCreateSchema>;

export const AssistantListItemSchema = z.object({
  id: z.string().uuid(), // membershipId
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.literal("assistant"),
  createdAt: z.string().datetime(),
  existingUserLinked: z.boolean().optional(),
});
export type AssistantListItem = z.infer<typeof AssistantListItemSchema>;

export const AssistantListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AssistantListQuery = z.infer<typeof AssistantListQuerySchema>;

export const AssistantListResponseSchema = z.object({
  items: z.array(AssistantListItemSchema),
  nextCursor: z.string().uuid().nullable(),
});
export type AssistantListResponse = z.infer<typeof AssistantListResponseSchema>;

export const AssistantDeleteResponseSchema = z.object({
  id: z.string().uuid(),
  deleted: z.literal(true),
  sessionsEnded: z.number().int().nonnegative(),
});
export type AssistantDeleteResponse = z.infer<typeof AssistantDeleteResponseSchema>;
