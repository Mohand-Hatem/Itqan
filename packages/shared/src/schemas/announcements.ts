import { z } from "zod";

export const CreateAnnouncementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
  body: z.string().trim().min(1, "Body is required"),
  courseId: z.string().uuid("Invalid course ID").optional().nullable(),
});

export type CreateAnnouncementDto = z.infer<typeof CreateAnnouncementSchema>;

export const AnnouncementItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  courseId: z.string().uuid().nullable(),
  title: z.string(),
  body: z.string(),
  publishedAt: z.coerce.date(),
  createdBy: z.string().uuid(),
  authorName: z.string().optional(),
  courseTitle: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
});

export type AnnouncementDto = z.infer<typeof AnnouncementItemSchema>;

export const ListAnnouncementsQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type ListAnnouncementsQueryDto = z.infer<typeof ListAnnouncementsQuerySchema>;

export const ListAnnouncementsResponseSchema = z.object({
  items: z.array(AnnouncementItemSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type ListAnnouncementsResponseDto = z.infer<typeof ListAnnouncementsResponseSchema>;
