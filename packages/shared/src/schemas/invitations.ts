import { z } from "zod";

export const InvitationCreateSchema = z.object({
  email: z.string().trim().email("Invalid email address").toLowerCase(),
  courseIds: z
    .array(z.string().uuid("Invalid course ID"))
    .min(1, "At least one course is required"),
});
export type InvitationCreateInput = z.infer<typeof InvitationCreateSchema>;

export const InvitationListQuerySchema = z.object({
  status: z.enum(["pending", "redeemed", "revoked", "expired"]).optional(),
  cursor: z.string().uuid("Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type InvitationListQueryInput = z.infer<typeof InvitationListQuerySchema>;

export const InvitationCheckQuerySchema = z.object({
  token: z.string().min(10, "Invalid invitation token"),
});
export type InvitationCheckQueryInput = z.infer<typeof InvitationCheckQuerySchema>;

export const InvitationRegisterSchema = z
  .object({
    token: z.string().min(10, "Invalid invitation token"),
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name cannot exceed 100 characters"),
    password: z.string().min(8, "Password must be at least 8 characters").max(100),
    phone: z.string().trim().optional(),
    isMinor: z.boolean().default(false),
    guardianConsent: z.boolean().default(false),
  })
  .refine((data) => !data.isMinor || data.guardianConsent, {
    message: "Guardian consent is required for students under 18.",
    path: ["guardianConsent"],
  });
export type InvitationRegisterInput = z.infer<typeof InvitationRegisterSchema>;

export const InvitationAcceptSchema = z
  .object({
    token: z.string().min(10, "Invalid invitation token"),
    isMinor: z.boolean().optional(),
    guardianConsent: z.boolean().optional(),
  })
  .refine((data) => !data.isMinor || data.guardianConsent, {
    message: "Guardian consent is required for students under 18.",
    path: ["guardianConsent"],
  });
export type InvitationAcceptInput = z.infer<typeof InvitationAcceptSchema>;
