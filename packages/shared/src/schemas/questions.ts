import { z } from "zod";

export const QuestionTypeSchema = z.enum(["single", "multiple", "true_false"]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const QuestionDifficultySchema = z.enum(["easy", "medium", "hard"]);
export type QuestionDifficulty = z.infer<typeof QuestionDifficultySchema>;

export const QuestionReasonCode = {
  QUESTION_BANK_NOT_FOUND: "QUESTION_BANK_NOT_FOUND",
  QUESTION_NOT_FOUND: "QUESTION_NOT_FOUND",
  INVALID_OPTION_COUNT: "INVALID_OPTION_COUNT",
  INVALID_CORRECT_OPTION_COUNT: "INVALID_CORRECT_OPTION_COUNT",
  ASSET_NOT_USABLE: "ASSET_NOT_USABLE",
  COURSE_NOT_FOUND: "COURSE_NOT_FOUND",
  FORBIDDEN_ROLE: "FORBIDDEN_ROLE",
} as const;
export type QuestionReasonCode = (typeof QuestionReasonCode)[keyof typeof QuestionReasonCode];

export const QuestionOptionInputSchema = z.object({
  id: z.string().uuid().optional(),
  text: z.string().trim().min(1, "Option text is required").max(1000),
  isCorrect: z.boolean().default(false),
});
export type QuestionOptionInput = z.infer<typeof QuestionOptionInputSchema>;

export const QuestionBankCreateSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  courseId: z.string().uuid().nullable().optional(),
});
export type QuestionBankCreateInput = z.infer<typeof QuestionBankCreateSchema>;

export const QuestionBankUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(200).optional(),
  courseId: z.string().uuid().nullable().optional(),
});
export type QuestionBankUpdateInput = z.infer<typeof QuestionBankUpdateSchema>;

export const QuestionBankQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type QuestionBankQueryInput = z.infer<typeof QuestionBankQuerySchema>;

export const QuestionQuerySchema = z.object({
  difficulty: QuestionDifficultySchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type QuestionQueryInput = z.infer<typeof QuestionQuerySchema>;

function validateOptionsForType(
  type: QuestionType,
  options: QuestionOptionInput[],
  ctx: z.RefinementCtx,
) {
  const correctCount = options.filter((o) => o.isCorrect).length;
  if (type === "single") {
    if (options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Single-choice questions must have at least 2 options",
        path: ["options"],
      });
    }
    if (correctCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Single-choice questions must have exactly one correct option",
        path: ["options"],
      });
    }
  } else if (type === "multiple") {
    if (options.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Multiple-choice questions must have at least 2 options",
        path: ["options"],
      });
    }
    if (correctCount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Multiple-choice questions must have at least one correct option",
        path: ["options"],
      });
    }
  } else if (type === "true_false") {
    if (options.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "True/False questions must have exactly 2 options",
        path: ["options"],
      });
    }
    if (correctCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "True/False questions must have exactly one correct option",
        path: ["options"],
      });
    }
  }
}

export const QuestionCreateSchema = z
  .object({
    type: QuestionTypeSchema,
    text: z.string().trim().min(1, "Question text is required").max(10000),
    imageAssetId: z.string().uuid().nullable().optional(),
    marks: z
      .number()
      .positive("Marks must be positive")
      .max(1000, "Marks cannot exceed 1000")
      .refine((val) => Number(val.toFixed(2)) === val, "Marks can have at most 2 decimal places")
      .default(1),
    difficulty: QuestionDifficultySchema.default("medium"),
    explanation: z.string().trim().max(10000).nullable().optional(),
    tags: z
      .array(z.string().trim().min(1).max(30).toLowerCase())
      .max(10, "Cannot exceed 10 tags")
      .default([]),
    options: z.array(QuestionOptionInputSchema),
  })
  .superRefine((data, ctx) => {
    validateOptionsForType(data.type, data.options, ctx);
  });
export type QuestionCreateInput = z.infer<typeof QuestionCreateSchema>;

export const QuestionUpdateSchema = z
  .object({
    type: QuestionTypeSchema.optional(),
    text: z.string().trim().min(1).max(10000).optional(),
    imageAssetId: z.string().uuid().nullable().optional(),
    marks: z
      .number()
      .positive("Marks must be positive")
      .max(1000, "Marks cannot exceed 1000")
      .refine((val) => Number(val.toFixed(2)) === val, "Marks can have at most 2 decimal places")
      .optional(),
    difficulty: QuestionDifficultySchema.optional(),
    explanation: z.string().trim().max(10000).nullable().optional(),
    tags: z
      .array(z.string().trim().min(1).max(30).toLowerCase())
      .max(10, "Cannot exceed 10 tags")
      .optional(),
    options: z.array(QuestionOptionInputSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.options && data.type) {
      validateOptionsForType(data.type, data.options, ctx);
    }
  });
export type QuestionUpdateInput = z.infer<typeof QuestionUpdateSchema>;
