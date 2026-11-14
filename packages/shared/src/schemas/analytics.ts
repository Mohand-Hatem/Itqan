import { z } from "zod";

export const AnalyticsOverviewResponseSchema = z.object({
  students: z.number().int().nonnegative(),
  activeStudents7d: z.number().int().nonnegative(),
  courses: z.number().int().nonnegative(),
  publishedItems: z.number().int().nonnegative(),
  quizParticipation: z.number().int().nonnegative(),
  averageGrade: z.number().nullable(),
  pendingRequests: z.number().int().nonnegative(),
});

export type AnalyticsOverviewResponseDto = z.infer<typeof AnalyticsOverviewResponseSchema>;
