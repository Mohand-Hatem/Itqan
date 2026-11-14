import { z } from "zod";

export const CreateGeneralSupportRequestSchema = z.object({
  message: z.string().trim().min(5).max(5000),
});

export type CreateGeneralSupportRequestDto = z.infer<typeof CreateGeneralSupportRequestSchema>;

export const RespondSupportRequestSchema = z.object({
  response: z.string().trim().max(5000).optional(),
});

export type RespondSupportRequestDto = z.infer<typeof RespondSupportRequestSchema>;

export const StudentSupportRequestItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["device_change", "sign_out_other", "general"]),
  status: z.enum(["open", "approved", "rejected", "closed"]),
  message: z.string().nullable(),
  response: z.string().nullable(),
  createdAt: z.coerce.date(),
  decidedAt: z.coerce.date().nullable(),
});

export type StudentSupportRequestItemDto = z.infer<typeof StudentSupportRequestItemSchema>;

export const StudentSupportRequestListResponseSchema = z.object({
  items: z.array(StudentSupportRequestItemSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type StudentSupportRequestListResponseDto = z.infer<typeof StudentSupportRequestListResponseSchema>;
