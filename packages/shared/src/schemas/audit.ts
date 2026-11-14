import { z } from "zod";

export const AuditLogListQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditLogListQueryDto = z.infer<typeof AuditLogListQuerySchema>;

export const AuditLogItemSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.coerce.date(),
  actor: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string(),
    })
    .nullable(),
});

export type AuditLogItemDto = z.infer<typeof AuditLogItemSchema>;

export const AuditLogListResponseSchema = z.object({
  items: z.array(AuditLogItemSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type AuditLogListResponseDto = z.infer<typeof AuditLogListResponseSchema>;
