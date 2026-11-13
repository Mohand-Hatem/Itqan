import { z } from "zod";

export const EnrollmentCreateSchema = z.object({
  courseId: z.string().uuid("Invalid course ID"),
});

export type EnrollmentCreateInput = z.infer<typeof EnrollmentCreateSchema>;
