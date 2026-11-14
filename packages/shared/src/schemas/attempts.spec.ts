import { describe, expect, it } from "vitest";
import {
  AttemptAnswersResponseSchema,
  AttemptReasonCode,
  AttemptResponseSchema,
  AttemptStatusSchema,
  AttemptSubmitResponseSchema,
  SaveAttemptAnswerSchema,
  SavedAttemptAnswerSchema,
  StudentAttemptQuestionSchema,
} from "./attempts.js";

describe("Attempt shared schemas", () => {
  it("defines standard AttemptReasonCode values", () => {
    expect(AttemptReasonCode.ATTEMPT_NOT_FOUND).toBe("ATTEMPT_NOT_FOUND");
    expect(AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH).toBe("ATTEMPT_DEVICE_MISMATCH");
    expect(AttemptReasonCode.MAX_ATTEMPTS_REACHED).toBe("MAX_ATTEMPTS_REACHED");
    expect(AttemptReasonCode.QUIZ_NOT_OPEN).toBe("QUIZ_NOT_OPEN");
    expect(AttemptReasonCode.QUIZ_CLOSED).toBe("QUIZ_CLOSED");
    expect(AttemptReasonCode.ENROLLMENT_REQUIRED).toBe("ENROLLMENT_REQUIRED");
    expect(AttemptReasonCode.DEVICE_NOT_REGISTERED).toBe("DEVICE_NOT_REGISTERED");

    // Step 8.6 reason codes
    expect(AttemptReasonCode.LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN).toBe(
      "LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN",
    );
    expect(AttemptReasonCode.LINEAR_NAVIGATION_SKIP_FORBIDDEN).toBe(
      "LINEAR_NAVIGATION_SKIP_FORBIDDEN",
    );
    expect(AttemptReasonCode.ATTEMPT_EXPIRED).toBe("ATTEMPT_EXPIRED");
    expect(AttemptReasonCode.ATTEMPT_ALREADY_SUBMITTED).toBe("ATTEMPT_ALREADY_SUBMITTED");
    expect(AttemptReasonCode.INVALID_QUESTION_OPTION).toBe("INVALID_QUESTION_OPTION");
    expect(AttemptReasonCode.SINGLE_CHOICE_VIOLATION).toBe("SINGLE_CHOICE_VIOLATION");
    expect(AttemptReasonCode.QUESTION_NOT_IN_ATTEMPT).toBe("QUESTION_NOT_IN_ATTEMPT");
  });

  it("validates valid AttemptResponseDto", () => {
    const valid = {
      id: "019323f4-1234-7890-abcd-ef0123456789",
      quizId: "019323f4-0000-7890-abcd-ef0123456789",
      quizTitle: "Biology 101 Midterm",
      attemptNo: 1,
      startedAt: "2026-11-14T10:00:00.000Z",
      deadlineAt: "2026-11-14T10:30:00.000Z",
      submittedAt: null,
      serverTime: "2026-11-14T10:00:01.000Z",
      remainingSeconds: 1799,
      extraTimeSec: 0,
      status: "in_progress",
      navigation: "free",
      maxScore: 20,
      totalQuestions: 1,
      resumed: false,
      questions: [
        {
          id: "019323f4-2222-7890-abcd-ef0123456789",
          text: "What is photosynthesis?",
          type: "single",
          marks: 2,
          imageAssetId: null,
          options: [
            { id: "019323f4-3333-7890-abcd-ef0123456789", text: "Plant energy process" },
            { id: "019323f4-4444-7890-abcd-ef0123456789", text: "Animal digestion process" },
          ],
        },
      ],
    };

    const parsed = AttemptResponseSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("validates attempt status enum", () => {
    expect(AttemptStatusSchema.safeParse("in_progress").success).toBe(true);
    expect(AttemptStatusSchema.safeParse("submitted").success).toBe(true);
    expect(AttemptStatusSchema.safeParse("expired").success).toBe(true);
    expect(AttemptStatusSchema.safeParse("cancelled").success).toBe(false);
  });

  it("validates StudentAttemptQuestionSchema", () => {
    const q = {
      id: "019323f4-2222-7890-abcd-ef0123456789",
      text: "True or false: water is H2O",
      type: "true_false",
      marks: 1,
      imageAssetId: null,
      options: [
        { id: "019323f4-3333-7890-abcd-ef0123456789", text: "True" },
        { id: "019323f4-4444-7890-abcd-ef0123456789", text: "False" },
      ],
    };

    const res = StudentAttemptQuestionSchema.safeParse(q);
    expect(res.success).toBe(true);
  });

  it("validates SaveAttemptAnswerSchema and AttemptAnswersResponseSchema", () => {
    const validSave = {
      selectedOptionIds: [
        "019323f4-3333-7890-abcd-ef0123456789",
        "019323f4-4444-7890-abcd-ef0123456789",
      ],
    };
    expect(SaveAttemptAnswerSchema.safeParse(validSave).success).toBe(true);

    const emptySave = { selectedOptionIds: [] };
    expect(SaveAttemptAnswerSchema.safeParse(emptySave).success).toBe(true);

    const invalidUuidSave = { selectedOptionIds: ["not-a-uuid"] };
    expect(SaveAttemptAnswerSchema.safeParse(invalidUuidSave).success).toBe(false);

    const validList = {
      answers: [
        {
          questionId: "019323f4-1111-7890-abcd-ef0123456789",
          selectedOptionIds: ["019323f4-3333-7890-abcd-ef0123456789"],
          savedAt: "2026-11-14T10:15:00.000Z",
        },
      ],
    };
    expect(AttemptAnswersResponseSchema.safeParse(validList).success).toBe(true);
  });

  it("validates AttemptSubmitResponseSchema for both released and unreleased grades", () => {
    const releasedSubmit = {
      id: "019323f4-1234-7890-abcd-ef0123456789",
      quizId: "019323f4-0000-7890-abcd-ef0123456789",
      attemptNo: 1,
      status: "submitted",
      submittedAt: "2026-11-14T10:25:00.000Z",
      autoSubmitted: false,
      gradesReleased: true,
      score: 18.5,
      maxScore: 20,
      percentage: 92.5,
      passed: true,
    };
    expect(AttemptSubmitResponseSchema.safeParse(releasedSubmit).success).toBe(true);

    const unreleasedSubmit = {
      id: "019323f4-1234-7890-abcd-ef0123456789",
      quizId: "019323f4-0000-7890-abcd-ef0123456789",
      attemptNo: 1,
      status: "submitted",
      submittedAt: "2026-11-14T10:30:00.000Z",
      autoSubmitted: true,
      gradesReleased: false,
      score: null,
      maxScore: null,
      percentage: null,
      passed: null,
    };
    expect(AttemptSubmitResponseSchema.safeParse(unreleasedSubmit).success).toBe(true);
  });
});
