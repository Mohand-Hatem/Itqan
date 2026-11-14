import { z } from "zod";

export const ATTEMPT_GRACE_PERIOD_SEC = 10;

export const AttemptReasonCode = {
  ATTEMPT_NOT_FOUND: "ATTEMPT_NOT_FOUND",
  ATTEMPT_DEVICE_MISMATCH: "ATTEMPT_DEVICE_MISMATCH",
  MAX_ATTEMPTS_REACHED: "MAX_ATTEMPTS_REACHED",
  QUIZ_NOT_OPEN: "QUIZ_NOT_OPEN",
  QUIZ_CLOSED: "QUIZ_CLOSED",
  ENROLLMENT_REQUIRED: "ENROLLMENT_REQUIRED",
  DEVICE_NOT_REGISTERED: "DEVICE_NOT_REGISTERED",
  QUIZ_NOT_PUBLISHED: "QUIZ_NOT_PUBLISHED",
  INSUFFICIENT_BANK_QUESTIONS: "INSUFFICIENT_BANK_QUESTIONS",

  // Step 8.6: Autosave & Linear Navigation
  LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN: "LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN",
  LINEAR_NAVIGATION_SKIP_FORBIDDEN: "LINEAR_NAVIGATION_SKIP_FORBIDDEN",
  ATTEMPT_EXPIRED: "ATTEMPT_EXPIRED",
  ATTEMPT_ALREADY_SUBMITTED: "ATTEMPT_ALREADY_SUBMITTED",
  INVALID_QUESTION_OPTION: "INVALID_QUESTION_OPTION",
  SINGLE_CHOICE_VIOLATION: "SINGLE_CHOICE_VIOLATION",
  QUESTION_NOT_IN_ATTEMPT: "QUESTION_NOT_IN_ATTEMPT",

  // Step 8.10: Grade & Review Modes
  REVIEW_NOT_RELEASED: "REVIEW_NOT_RELEASED",
  ATTEMPT_NOT_SUBMITTED: "ATTEMPT_NOT_SUBMITTED",

  // Step 8.12: Rescue Actions (FR-X09)
  DEVICE_NOT_FOUND: "DEVICE_NOT_FOUND",
  INVALID_DEVICE_STATUS: "INVALID_DEVICE_STATUS",
  ATTEMPT_CANNOT_REOPEN: "ATTEMPT_CANNOT_REOPEN",
} as const;
export type AttemptReasonCode = (typeof AttemptReasonCode)[keyof typeof AttemptReasonCode];

export type StoredAttemptQuestionOption = {
  id: string;
  text: string;
  isCorrect: boolean;
  sortOrder: number;
};

export type StoredAttemptQuestion = {
  id: string;
  text: string;
  type: "single" | "multiple" | "true_false";
  marks: number;
  explanation: string | null;
  imageAssetId: string | null;
  options: StoredAttemptQuestionOption[];
};

export type StoredAttemptSnapshot = {
  questions: StoredAttemptQuestion[];
};

export const StudentAttemptOptionSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
});
export type StudentAttemptOptionDto = z.infer<typeof StudentAttemptOptionSchema>;

export const StudentAttemptQuestionSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  type: z.enum(["single", "multiple", "true_false"]),
  marks: z.number(),
  imageAssetId: z.string().uuid().nullable(),
  options: z.array(StudentAttemptOptionSchema),
});
export type StudentAttemptQuestionDto = z.infer<typeof StudentAttemptQuestionSchema>;

export const AttemptStatusSchema = z.enum(["in_progress", "submitted", "expired"]);
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;

export const AttemptResponseSchema = z.object({
  id: z.string().uuid(),
  quizId: z.string().uuid(),
  quizTitle: z.string(),
  attemptNo: z.number().int(),
  startedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable(),
  serverTime: z.string().datetime(),
  remainingSeconds: z.number().int().min(0),
  extraTimeSec: z.number().int().min(0),
  status: AttemptStatusSchema,
  navigation: z.enum(["free", "linear"]),
  maxScore: z.number(),
  totalQuestions: z.number().int(),
  resumed: z.boolean(),
  questions: z.array(StudentAttemptQuestionSchema),
  gradesReleased: z.boolean().optional(),
  score: z.number().nullable().optional(),
  percentage: z.number().nullable().optional(),
  passed: z.boolean().nullable().optional(),
});
export type AttemptResponseDto = z.infer<typeof AttemptResponseSchema>;

export const SaveAttemptAnswerSchema = z.object({
  selectedOptionIds: z.array(z.string().uuid()),
});
export type SaveAttemptAnswerDto = z.infer<typeof SaveAttemptAnswerSchema>;

export const SavedAttemptAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedOptionIds: z.array(z.string().uuid()),
  savedAt: z.string().datetime(),
});
export type SavedAttemptAnswerDto = z.infer<typeof SavedAttemptAnswerSchema>;

export const AttemptAnswersResponseSchema = z.object({
  answers: z.array(SavedAttemptAnswerSchema),
});
export type AttemptAnswersResponseDto = z.infer<typeof AttemptAnswersResponseSchema>;

// Step 8.7: Submission Response
export const AttemptSubmitResponseSchema = z.object({
  id: z.string().uuid(),
  quizId: z.string().uuid(),
  attemptNo: z.number().int(),
  status: z.literal("submitted"),
  submittedAt: z.string().datetime(),
  autoSubmitted: z.boolean(),
  gradesReleased: z.boolean(),
  score: z.number().nullable(),
  maxScore: z.number().nullable(),
  percentage: z.number().nullable(),
  passed: z.boolean().nullable(),
});
export type AttemptSubmitResponseDto = z.infer<typeof AttemptSubmitResponseSchema>;

// Step 8.10: Review Response (FR-X07, FR-X08)
export const ReviewQuestionOptionSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  isCorrect: z.boolean(),
});
export type ReviewQuestionOptionDto = z.infer<typeof ReviewQuestionOptionSchema>;

export const ReviewQuestionSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  type: z.enum(["single", "multiple", "true_false"]),
  marks: z.number(),
  imageAssetId: z.string().uuid().nullable(),
  selectedOptionIds: z.array(z.string().uuid()),
  isCorrect: z.boolean(),
  marksAwarded: z.number(),
  explanation: z.string().nullable(),
  options: z.array(ReviewQuestionOptionSchema),
});
export type ReviewQuestionDto = z.infer<typeof ReviewQuestionSchema>;

export const AttemptReviewResponseSchema = z.object({
  attemptId: z.string().uuid(),
  quizId: z.string().uuid(),
  quizTitle: z.string(),
  attemptNo: z.number().int(),
  status: z.literal("submitted"),
  submittedAt: z.string().datetime(),
  reviewMode: z.enum(["grade", "grade_answers", "full"]),
  score: z.number(),
  maxScore: z.number(),
  percentage: z.number(),
  passed: z.boolean(),
  questions: z.array(ReviewQuestionSchema).nullable(),
});
export type AttemptReviewResponseDto = z.infer<typeof AttemptReviewResponseSchema>;

// Step 8.12: Rescue Actions (FR-X09)
export const AttemptExtendTimeSchema = z
  .object({
    extraMinutes: z.number().int().min(1).max(1440).optional(),
    extraTimeSec: z.number().int().min(1).max(86400).optional(),
    reopen: z.boolean().default(true),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.extraMinutes !== undefined || data.extraTimeSec !== undefined, {
    message: "Either extraMinutes or extraTimeSec must be provided.",
  });
export type AttemptExtendTimeDto = z.infer<typeof AttemptExtendTimeSchema>;

export const AttemptExtendTimeResponseSchema = z.object({
  success: z.literal(true),
  attemptId: z.string().uuid(),
  extraTimeSec: z.number().int().min(0),
  deadlineAt: z.string().datetime(),
  effectiveDeadlineAt: z.string().datetime(),
  status: AttemptStatusSchema,
  reopened: z.boolean(),
});
export type AttemptExtendTimeResponseDto = z.infer<typeof AttemptExtendTimeResponseSchema>;

export const AttemptMoveDeviceSchema = z
  .object({
    newDeviceId: z.string().uuid().optional(),
    deviceId: z.string().uuid().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.newDeviceId !== undefined || data.deviceId !== undefined, {
    message: "Either newDeviceId or deviceId must be provided.",
  });
export type AttemptMoveDeviceDto = z.infer<typeof AttemptMoveDeviceSchema>;

export const AttemptMoveDeviceResponseSchema = z.object({
  success: z.literal(true),
  attemptId: z.string().uuid(),
  previousDeviceId: z.string().uuid(),
  newDeviceId: z.string().uuid(),
});
export type AttemptMoveDeviceResponseDto = z.infer<typeof AttemptMoveDeviceResponseSchema>;

