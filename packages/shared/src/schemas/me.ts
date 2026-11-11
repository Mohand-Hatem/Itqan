import { z } from "zod";

export const PermissionsSchema = z.object({
  canManageTenants: z.boolean(),
  canManageSettings: z.boolean(),
  canManageAssistants: z.boolean(),
  canManagePayments: z.boolean(),
  canViewPayments: z.boolean(),
  canManageCourses: z.boolean(),
  canManageStudents: z.boolean(),
  canManageDevices: z.boolean(),
  canDeleteCourse: z.boolean(),
  canLearn: z.boolean(),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

export const MeUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  image: z.string().nullable().optional(),
  emailVerified: z.boolean(),
  isSuperAdmin: z.boolean(),
  twoFactorEnabled: z.boolean(),
  status: z.enum(["active", "suspended"]),
  createdAt: z.string(),
});

export type MeUser = z.infer<typeof MeUserSchema>;

export const MeTenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
});

export type MeTenant = z.infer<typeof MeTenantSchema>;

export const MeMembershipSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["teacher", "assistant", "student"]),
  status: z.enum(["active", "suspended"]),
  phone: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type MeMembership = z.infer<typeof MeMembershipSchema>;

export const MeMembershipItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  tenantName: z.string(),
  role: z.enum(["teacher", "assistant", "student"]),
  status: z.enum(["active", "suspended"]),
});

export type MeMembershipItem = z.infer<typeof MeMembershipItemSchema>;

export const MeResponseSchema = z.object({
  user: MeUserSchema,
  tenant: MeTenantSchema.nullable(),
  membership: MeMembershipSchema.nullable(),
  memberships: z.array(MeMembershipItemSchema),
  permissions: PermissionsSchema,
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

export function computePermissions(
  isSuperAdmin: boolean,
  role?: "teacher" | "assistant" | "student" | null,
): Permissions {
  if (isSuperAdmin) {
    return {
      canManageTenants: true,
      canManageSettings: true,
      canManageAssistants: true,
      canManagePayments: true,
      canViewPayments: true,
      canManageCourses: true,
      canManageStudents: true,
      canManageDevices: true,
      canDeleteCourse: true,
      canLearn: false,
    };
  }

  if (role === "teacher") {
    return {
      canManageTenants: false,
      canManageSettings: true,
      canManageAssistants: true,
      canManagePayments: true,
      canViewPayments: true,
      canManageCourses: true,
      canManageStudents: true,
      canManageDevices: true,
      canDeleteCourse: true,
      canLearn: false,
    };
  }

  if (role === "assistant") {
    return {
      canManageTenants: false,
      canManageSettings: false,
      canManageAssistants: false,
      canManagePayments: false,
      canViewPayments: true,
      canManageCourses: true,
      canManageStudents: true,
      canManageDevices: true,
      canDeleteCourse: false,
      canLearn: false,
    };
  }

  if (role === "student") {
    return {
      canManageTenants: false,
      canManageSettings: false,
      canManageAssistants: false,
      canManagePayments: false,
      canViewPayments: false,
      canManageCourses: false,
      canManageStudents: false,
      canManageDevices: false,
      canDeleteCourse: false,
      canLearn: true,
    };
  }

  return {
    canManageTenants: false,
    canManageSettings: false,
    canManageAssistants: false,
    canManagePayments: false,
    canViewPayments: false,
    canManageCourses: false,
    canManageStudents: false,
    canManageDevices: false,
    canDeleteCourse: false,
    canLearn: false,
  };
}
