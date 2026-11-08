import { z } from "zod";

export const TenantSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9-]+$/,
    "Tenant slug must contain only lowercase alphanumeric characters and hyphens",
  );

export const TenantSchema = z.object({
  id: z.string().uuid(),
  slug: TenantSlugSchema,
  name: z.string().min(1).max(100),
  domain: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type Tenant = z.infer<typeof TenantSchema>;
