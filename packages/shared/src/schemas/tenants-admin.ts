import { z } from "zod";

export const RESERVED_TENANT_SLUGS = [
  "admin",
  "api",
  "app",
  "www",
  "localhost",
  "mail",
  "static",
  "support",
  "status",
  "health",
  "docs",
  "auth",
  "public",
] as const;

export const AdminTenantSlugSchema = z
  .string()
  .trim()
  .min(3, "Slug must be at least 3 characters")
  .max(32, "Slug must be at most 32 characters")
  .regex(
    /^[a-z0-9](?!.*--)[a-z0-9-]{1,30}[a-z0-9]$/,
    "Slug must start and end with an alphanumeric character and may only contain lowercase letters, numbers, and non-consecutive hyphens",
  )
  .refine(
    (slug) => !RESERVED_TENANT_SLUGS.includes(slug as (typeof RESERVED_TENANT_SLUGS)[number]),
    {
      message: "This subdomain slug is reserved by the platform",
    },
  );

export const AdminTenantCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: AdminTenantSlugSchema,
  teacherEmail: z.string().trim().toLowerCase().email(),
  teacherName: z.string().trim().min(2).max(100).optional(),
  temporaryPassword: z.string().min(8).max(100),
});
export type AdminTenantCreateDto = z.infer<typeof AdminTenantCreateSchema>;

export const AdminTenantUsageSchema = z.object({
  studentCount: z.number().int().nonnegative(),
  courseCount: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
});
export type AdminTenantUsage = z.infer<typeof AdminTenantUsageSchema>;

export const AdminTenantListItemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["active", "deleted"]),
  pausedRoles: z.array(z.enum(["teacher", "assistant", "student"])).default([]),
  teacher: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string().email(),
    })
    .nullable(),
  usage: AdminTenantUsageSchema,
  createdAt: z.string().datetime(),
  existingUserLinked: z.boolean().optional(),
});
export type AdminTenantListItem = z.infer<typeof AdminTenantListItemSchema>;

export const AdminTenantListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminTenantListQuery = z.infer<typeof AdminTenantListQuerySchema>;

export const AdminTenantListResponseSchema = z.object({
  items: z.array(AdminTenantListItemSchema),
  nextCursor: z.string().uuid().nullable(),
});
export type AdminTenantListResponse = z.infer<typeof AdminTenantListResponseSchema>;

export const AdminTenantUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    slug: AdminTenantSlugSchema.optional(),
    pausedRoles: z.array(z.enum(["teacher", "assistant", "student"])).optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.slug !== undefined || data.pausedRoles !== undefined,
    {
      message: "At least one of name, slug, or pausedRoles must be provided",
    },
  );
export type AdminTenantUpdateDto = z.infer<typeof AdminTenantUpdateSchema>;

export const AdminTenantSoftDeleteResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("deleted"),
  deletedAt: z.string().datetime(),
  sessionsEvicted: z.number().int().nonnegative(),
});
export type AdminTenantSoftDeleteResponse = z.infer<typeof AdminTenantSoftDeleteResponseSchema>;

export const AdminUserUpdateSchema = z.object({
  status: z.enum(["active", "suspended"]),
});
export type AdminUserUpdateDto = z.infer<typeof AdminUserUpdateSchema>;

export const AdminUserUpdateResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  status: z.enum(["active", "suspended"]),
  sessionsEvicted: z.number().int().nonnegative(),
});
export type AdminUserUpdateResponse = z.infer<typeof AdminUserUpdateResponseSchema>;
