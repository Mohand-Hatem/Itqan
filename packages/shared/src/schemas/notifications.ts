import { z } from "zod";

export const NotificationTypeSchema = z.string().min(1).max(100);

export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  title: z.string().min(1),
  body: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type NotificationItemDto = z.infer<typeof NotificationItemSchema>;

export const ListNotificationsQuerySchema = z.object({
  unreadOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((val) => val === true || val === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type ListNotificationsQueryDto = z.infer<typeof ListNotificationsQuerySchema>;

export const ListNotificationsResponseSchema = z.object({
  items: z.array(NotificationItemSchema),
  unreadCount: z.number().int().nonnegative(),
  nextCursor: z.string().uuid().nullable(),
});

export type ListNotificationsResponseDto = z.infer<typeof ListNotificationsResponseSchema>;

export const MarkNotificationsReadSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
});

export type MarkNotificationsReadDto = z.infer<typeof MarkNotificationsReadSchema>;

export const MarkNotificationsReadResponseSchema = z.object({
  updatedCount: z.number().int().nonnegative(),
});

export type MarkNotificationsReadResponseDto = z.infer<typeof MarkNotificationsReadResponseSchema>;
