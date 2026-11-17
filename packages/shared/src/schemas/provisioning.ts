import { z } from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./auth.js";

/** Reasons the account-creation routes answer with (10R.4, ADR-013). */
export const ProvisioningReason = {
  /** Teachers and assistants cannot attach an existing account directly: they send an invitation. */
  USE_INVITATION: "USE_INVITATION",
  MEMBERSHIP_ALREADY_EXISTS: "MEMBERSHIP_ALREADY_EXISTS",
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  NAME_REQUIRED: "NAME_REQUIRED",
  /** 10R.5 (FR-T02): a tenant always keeps one active teacher; add the new one first. */
  LAST_TEACHER: "LAST_TEACHER",
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  NOT_STAFF: "NOT_STAFF",
} as const;

/** Body of POST /api/students (10R.4): teacher or assistant creates a student directly. */
export const StudentCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(PASSWORD_MIN_LENGTH.student).max(PASSWORD_MAX_LENGTH),
    phone: z.string().trim().max(30).optional(),
    courseIds: z.array(z.string().uuid()).max(50).default([]),
    /** FR-A08: on by default; staff may turn it off for one student. */
    requirePasswordChange: z.boolean().default(true),
    /** 10R.7 (FR-A06): set at creation; afterwards only the super admin changes it. */
    isMinor: z.boolean().default(false),
  })
  .strict();

export type StudentCreateInput = z.infer<typeof StudentCreateSchema>;

/**
 * Body of POST /api/admin/tenants/:id/members (10R.4): the super admin creates any role directly,
 * or links an existing account (then `name` and `password` are not used).
 */
export const AdminMemberCreateSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    role: z.enum(["teacher", "assistant", "student"]),
    name: z.string().trim().min(2).max(100).optional(),
    password: z.string().min(PASSWORD_MIN_LENGTH.student).max(PASSWORD_MAX_LENGTH).optional(),
    phone: z.string().trim().max(30).optional(),
    courseIds: z.array(z.string().uuid()).max(50).default([]),
    requirePasswordChange: z.boolean().default(true),
    /** Used only when a new student account is created; a linked account keeps its own value. */
    isMinor: z.boolean().default(false),
  })
  .strict();

export type AdminMemberCreateInput = z.infer<typeof AdminMemberCreateSchema>;

/** What every direct creation returns. Never the password. */
export const ProvisionResultSchema = z.object({
  userId: z.string().uuid(),
  membershipId: z.string().uuid(),
  role: z.enum(["teacher", "assistant", "student"]),
  existingUserLinked: z.boolean(),
  emailVerified: z.boolean(),
  mustChangePassword: z.boolean(),
  enrollmentIds: z.array(z.string().uuid()),
  /** 10R.7: `required` means content stays closed until a guardian consents. */
  guardianConsent: z.enum(["not_required", "required", "pending", "given"]),
});

export type ProvisionResult = z.infer<typeof ProvisionResultSchema>;

/** Query of GET /api/admin/tenants/:id/members (10R.5). `role` is a comma list; default staff. */
export const AdminMemberListQuerySchema = z.object({
  role: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(",").map((r) => r.trim()) : ["teacher", "assistant"]))
    .pipe(z.array(z.enum(["teacher", "assistant", "student"])).min(1)),
  status: z.enum(["active", "suspended"]).optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminMemberListQuery = z.infer<typeof AdminMemberListQuerySchema>;

export const AdminMemberSchema = z.object({
  membershipId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["teacher", "assistant", "student"]),
  status: z.enum(["active", "suspended"]),
  userStatus: z.enum(["active", "suspended", "pending"]),
  emailVerified: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
});

export type AdminMember = z.infer<typeof AdminMemberSchema>;

export const AdminMemberListResponseSchema = z.object({
  items: z.array(AdminMemberSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type AdminMemberListResponse = z.infer<typeof AdminMemberListResponseSchema>;

/** Body of PATCH /api/admin/tenants/:id/members/:membershipId (10R.5). Students keep their role. */
export const AdminMemberUpdateSchema = z
  .object({
    role: z.enum(["teacher", "assistant"]).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .strict()
  .refine((body) => body.role !== undefined || body.status !== undefined, {
    message: "Nothing to change.",
  });

export type AdminMemberUpdate = z.infer<typeof AdminMemberUpdateSchema>;
