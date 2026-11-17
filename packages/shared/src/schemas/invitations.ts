import { z } from "zod";
import { GuardianInfoSchema } from "./guardian-consent.js";

export const InvitationCreateSchema = z
  .object({
    email: z.string().trim().email("Invalid email address").toLowerCase(),
    // 10R.6 (FR-E01): who may invite which role is checked by the service.
    role: z.enum(["teacher", "assistant", "student"]).default("student"),
    courseIds: z.array(z.string().uuid("Invalid course ID")).default([]),
  })
  .refine((data) => (data.role === "student" ? data.courseIds.length > 0 : data.courseIds.length === 0), {
    message: "Student invitations need at least one course; staff invitations take none.",
    path: ["courseIds"],
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
    // Staff invitations need 12 characters (FR-A09), checked against the invitation's role.
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    phone: z.string().trim().optional(),
    // 10R.7 (FR-A06): used for student invitations only.
    isMinor: z.boolean().default(false),
    guardian: GuardianInfoSchema.optional(),
  })
  .refine((data) => data.isMinor || !data.guardian, {
    message: "A guardian is named only for a student under 18.",
    path: ["guardian"],
  });
export type InvitationRegisterInput = z.infer<typeof InvitationRegisterSchema>;

/** 10R.7: accepting never asks for consent; the account's own consent state applies. */
export const InvitationAcceptSchema = z.object({
  token: z.string().min(10, "Invalid invitation token"),
});
export type InvitationAcceptInput = z.infer<typeof InvitationAcceptSchema>;

/**
 * Body of POST /api/invitations/accept-with-password (10R.6): for an account that cannot sign in
 * yet (pending). The token proves the mailbox, the password proves the account; neither alone is
 * enough, and the password is never changed.
 */
export const InvitationAcceptWithPasswordSchema = z
  .object({
    token: z.string().min(10, "Invalid invitation token"),
    password: z.string().min(1).max(256),
  })
  .strict();
export type InvitationAcceptWithPasswordInput = z.infer<typeof InvitationAcceptWithPasswordSchema>;
