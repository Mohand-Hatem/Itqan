import { z } from "zod";

export const StudentListQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(["all", "active", "suspended"]).default("all").optional(),
  courseId: z.string().uuid("Invalid course ID").optional(),
  cursor: z.string().uuid("Invalid cursor").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type StudentListQueryInput = z.infer<typeof StudentListQuerySchema>;
