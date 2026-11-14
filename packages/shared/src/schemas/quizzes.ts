import { z } from "zod";

export const QuizSelectionSchema = z.enum(["manual", "random"]);
export type QuizSelection = z.infer<typeof QuizSelectionSchema>;

export const QuizNavigationSchema = z.enum(["free", "linear"]);
export type QuizNavigation = z.infer<typeof QuizNavigationSchema>;

export const GradeReleaseSchema = z.enum(["on_submit", "all_submitted", "on_close", "manual"]);
export type GradeRelease = z.infer<typeof GradeReleaseSchema>;

export const ReviewModeSchema = z.enum(["grade", "grade_answers", "full"]);
export type ReviewMode = z.infer<typeof ReviewModeSchema>;

export const QuizReasonCode = {
  QUIZ_NOT_FOUND: "QUIZ_NOT_FOUND",
  QUIZ_ALREADY_PUBLISHED: "QUIZ_ALREADY_PUBLISHED",
  QUIZ_NOT_PUBLISHED: "QUIZ_NOT_PUBLISHED",
  QUIZ_MUTATION_LOCKED: "QUIZ_MUTATION_LOCKED",
  INVALID_TIMING_WINDOW: "INVALID_TIMING_WINDOW",
  INSUFFICIENT_BANK_QUESTIONS: "INSUFFICIENT_BANK_QUESTIONS",
  INVALID_TARGET: "INVALID_TARGET",
  TARGET_COURSE_MISMATCH: "TARGET_COURSE_MISMATCH",
  QUESTION_COURSE_MISMATCH: "QUESTION_COURSE_MISMATCH",
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  QUIZ_HAS_ATTEMPTS: "QUIZ_HAS_ATTEMPTS",
  GRADES_ALREADY_RELEASED: "GRADES_ALREADY_RELEASED",
} as const;
export type QuizReasonCode = (typeof QuizReasonCode)[keyof typeof QuizReasonCode];

const Title = z.string().trim().min(1).max(200);
const Description = z.string().trim().max(2000).nullish();

const validateTiming = (opensAt?: string, closesAt?: string | null, durationMin?: number) => {
  if (!opensAt || !closesAt || durationMin === undefined) return true;
  const openTime = new Date(opensAt).getTime();
  const closeTime = new Date(closesAt).getTime();
  return closeTime - openTime >= durationMin * 60 * 1000;
};

export const QuizCreateSchema = z
  .object({
    courseId: z.string().uuid(),
    title: Title,
    description: Description,
    durationMin: z.number().int().min(1).max(300),
    passMark: z.number().min(0).max(100),
    maxAttempts: z.number().int().min(1).max(10).default(1),
    selection: QuizSelectionSchema.default("manual"),
    randomCount: z.number().int().min(1).optional(),
    randomBankIds: z.array(z.string().uuid()).default([]),
    questionIds: z.array(z.string().uuid()).default([]),
    targetContentItemIds: z.array(z.string().uuid()).default([]),
    shuffleQuestions: z.boolean().default(false),
    shuffleOptions: z.boolean().default(false),
    navigation: QuizNavigationSchema.default("free"),
    graceSec: z.number().int().min(0).max(300).default(10),
    gradeRelease: GradeReleaseSchema.default("on_submit"),
    reviewMode: ReviewModeSchema.default("full"),
    opensAt: z.string().datetime(),
    closesAt: z.string().datetime().nullish(),
    reviewReleaseAt: z.string().datetime().nullish(),
  })
  .refine((v) => validateTiming(v.opensAt, v.closesAt, v.durationMin), {
    message: "Closing time must be at least durationMin after opening time",
    path: ["closesAt"],
  })
  .refine(
    (v) => {
      if (v.selection === "random") {
        return (v.randomBankIds?.length ?? 0) >= 1 && (v.randomCount ?? 0) >= 1;
      }
      return true;
    },
    {
      message: "Random selection requires at least one question bank and randomCount >= 1",
      path: ["randomBankIds"],
    },
  );
export type QuizCreateInput = z.infer<typeof QuizCreateSchema>;

export const QuizUpdateSchema = z
  .object({
    title: Title.optional(),
    description: Description.optional(),
    durationMin: z.number().int().min(1).max(300).optional(),
    passMark: z.number().min(0).max(100).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    selection: QuizSelectionSchema.optional(),
    randomCount: z.number().int().min(1).nullish(),
    randomBankIds: z.array(z.string().uuid()).optional(),
    questionIds: z.array(z.string().uuid()).optional(),
    targetContentItemIds: z.array(z.string().uuid()).optional(),
    shuffleQuestions: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
    navigation: QuizNavigationSchema.optional(),
    graceSec: z.number().int().min(0).max(300).optional(),
    gradeRelease: GradeReleaseSchema.optional(),
    reviewMode: ReviewModeSchema.optional(),
    opensAt: z.string().datetime().optional(),
    closesAt: z.string().datetime().nullish(),
    reviewReleaseAt: z.string().datetime().nullish(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update")
  .refine(
    (v) => {
      if (v.selection === "random") {
        if (v.randomBankIds !== undefined && v.randomBankIds.length === 0) return false;
        if (v.randomCount !== undefined && (v.randomCount === null || v.randomCount < 1))
          return false;
      }
      return true;
    },
    {
      message: "Random selection requires non-empty randomBankIds and randomCount >= 1",
      path: ["randomBankIds"],
    },
  );
export type QuizUpdateInput = z.infer<typeof QuizUpdateSchema>;

export const QuizListQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  published: z.enum(["true", "false", "all"]).default("all"),
});
export type QuizListQuery = z.infer<typeof QuizListQuerySchema>;

export type QuizTargetResponse = {
  id: string;
  contentItemId: string;
};

export type QuizQuestionResponse = {
  id: string;
  questionId: string;
  sortOrder: number;
};

export type QuizResponse = {
  id: string;
  tenantId: string;
  courseId: string;
  title: string;
  description: string | null;
  durationMin: number;
  passMark: number;
  maxAttempts: number;
  selection: QuizSelection;
  randomCount: number | null;
  randomBankIds: string[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  navigation: QuizNavigation;
  graceSec: number;
  gradeRelease: GradeRelease;
  reviewMode: ReviewMode;
  opensAt: string;
  closesAt: string | null;
  gradesReleasedAt: string | null;
  reviewReleaseAt: string | null;
  publishedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  targets: QuizTargetResponse[];
  questions: QuizQuestionResponse[];
};

export const QuizReleaseGradesResponseSchema = z.object({
  success: z.literal(true),
  quizId: z.string().uuid(),
  gradesReleasedAt: z.string().datetime(),
});
export type QuizReleaseGradesResponseDto = z.infer<typeof QuizReleaseGradesResponseSchema>;
