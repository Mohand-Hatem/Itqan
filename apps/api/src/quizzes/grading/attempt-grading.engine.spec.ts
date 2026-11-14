import type { StoredAttemptQuestion } from "@itqan/shared";
import { describe, expect, it } from "vitest";
import { gradeAttempt, isGradeReleased, isReviewReleased } from "./attempt-grading.engine.js";

describe("attempt-grading.engine", () => {
  const mockSingle: StoredAttemptQuestion = {
    id: "019323f4-1111-7890-abcd-ef0123456789",
    text: "What is 2 + 2?",
    type: "single",
    marks: 2,
    explanation: "2 + 2 = 4",
    imageAssetId: null,
    options: [
      { id: "opt-1a", text: "3", isCorrect: false, sortOrder: 0 },
      { id: "opt-1b", text: "4", isCorrect: true, sortOrder: 1 },
      { id: "opt-1c", text: "5", isCorrect: false, sortOrder: 2 },
    ],
  };

  const mockTF: StoredAttemptQuestion = {
    id: "019323f4-2222-7890-abcd-ef0123456789",
    text: "Water is H2O",
    type: "true_false",
    marks: 1,
    explanation: "Water formula is H2O",
    imageAssetId: null,
    options: [
      { id: "opt-2t", text: "True", isCorrect: true, sortOrder: 0 },
      { id: "opt-2f", text: "False", isCorrect: false, sortOrder: 1 },
    ],
  };

  const mockMulti: StoredAttemptQuestion = {
    id: "019323f4-3333-7890-abcd-ef0123456789",
    text: "Select prime numbers",
    type: "multiple",
    marks: 3,
    explanation: "2 and 3 are primes",
    imageAssetId: null,
    options: [
      { id: "opt-3a", text: "2", isCorrect: true, sortOrder: 0 },
      { id: "opt-3b", text: "3", isCorrect: true, sortOrder: 1 },
      { id: "opt-3c", text: "4", isCorrect: false, sortOrder: 2 },
      { id: "opt-3d", text: "9", isCorrect: false, sortOrder: 3 },
    ],
  };

  describe("Single choice grading", () => {
    it("awards full marks when correct option is selected", () => {
      const result = gradeAttempt([mockSingle], [{ questionId: mockSingle.id, selectedOptionIds: ["opt-1b"] }], 50);
      expect(result.score).toBe(2);
      expect(result.maxScore).toBe(2);
      expect(result.percentage).toBe(100);
      expect(result.passed).toBe(true);
      expect(result.answers[0]!.isCorrect).toBe(true);
      expect(result.answers[0]!.marksAwarded).toBe(2);
    });

    it("awards 0 marks when incorrect option is selected", () => {
      const result = gradeAttempt([mockSingle], [{ questionId: mockSingle.id, selectedOptionIds: ["opt-1a"] }], 50);
      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.answers[0]!.isCorrect).toBe(false);
      expect(result.answers[0]!.marksAwarded).toBe(0);
    });

    it("awards 0 marks when empty or multiple options are sent", () => {
      const emptyResult = gradeAttempt([mockSingle], [{ questionId: mockSingle.id, selectedOptionIds: [] }], 50);
      expect(emptyResult.answers[0]!.marksAwarded).toBe(0);

      const multiResult = gradeAttempt(
        [mockSingle],
        [{ questionId: mockSingle.id, selectedOptionIds: ["opt-1a", "opt-1b"] }],
        50,
      );
      expect(multiResult.answers[0]!.marksAwarded).toBe(0);
      expect(multiResult.answers[0]!.isCorrect).toBe(false);
    });
  });

  describe("True/False grading", () => {
    it("awards full marks on exact match", () => {
      const result = gradeAttempt([mockTF], [{ questionId: mockTF.id, selectedOptionIds: ["opt-2t"] }], 50);
      expect(result.score).toBe(1);
      expect(result.passed).toBe(true);
      expect(result.answers[0]!.isCorrect).toBe(true);
    });

    it("awards 0 marks on wrong selection", () => {
      const result = gradeAttempt([mockTF], [{ questionId: mockTF.id, selectedOptionIds: ["opt-2f"] }], 50);
      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
      expect(result.answers[0]!.isCorrect).toBe(false);
    });
  });

  describe("Multiple choice grading", () => {
    it("awards full marks on exact set match, regardless of option order", () => {
      // Order [3b, 3a] vs definition [3a, 3b]
      const result = gradeAttempt(
        [mockMulti],
        [{ questionId: mockMulti.id, selectedOptionIds: ["opt-3b", "opt-3a"] }],
        50,
      );
      expect(result.score).toBe(3);
      expect(result.passed).toBe(true);
      expect(result.answers[0]!.isCorrect).toBe(true);
      expect(result.answers[0]!.marksAwarded).toBe(3);
    });

    it("deduplicates student option IDs safely", () => {
      const result = gradeAttempt(
        [mockMulti],
        [{ questionId: mockMulti.id, selectedOptionIds: ["opt-3a", "opt-3b", "opt-3a"] }],
        50,
      );
      expect(result.score).toBe(3);
      expect(result.answers[0]!.isCorrect).toBe(true);
    });

    it("awards 0 marks when a correct option is missing (no partial credit in MVP)", () => {
      const result = gradeAttempt(
        [mockMulti],
        [{ questionId: mockMulti.id, selectedOptionIds: ["opt-3a"] }],
        50,
      );
      expect(result.score).toBe(0);
      expect(result.answers[0]!.isCorrect).toBe(false);
    });

    it("awards 0 marks when an incorrect option is included", () => {
      const result = gradeAttempt(
        [mockMulti],
        [{ questionId: mockMulti.id, selectedOptionIds: ["opt-3a", "opt-3b", "opt-3c"] }],
        50,
      );
      expect(result.score).toBe(0);
      expect(result.answers[0]!.isCorrect).toBe(false);
    });
  });

  describe("Mixed questions, fractional weights & precision", () => {
    it("correctly aggregates mixed weights without floating-point accumulation drift", () => {
      const qFrac1: StoredAttemptQuestion = {
        ...mockSingle,
        id: "q-f1",
        marks: 1.5,
      };
      const qFrac2: StoredAttemptQuestion = {
        ...mockTF,
        id: "q-f2",
        marks: 0.5,
      };
      const qFrac3: StoredAttemptQuestion = {
        ...mockMulti,
        id: "q-f3",
        marks: 2.5,
      };

      // Student gets Q1 and Q3 right (1.5 + 2.5 = 4.0 out of 4.5)
      const result = gradeAttempt(
        [qFrac1, qFrac2, qFrac3],
        [
          { questionId: "q-f1", selectedOptionIds: ["opt-1b"] },
          { questionId: "q-f2", selectedOptionIds: ["opt-2f"] }, // wrong
          { questionId: "q-f3", selectedOptionIds: ["opt-3a", "opt-3b"] },
        ],
        60, // passMark = 60%
      );

      expect(result.score).toBe(4.0);
      expect(result.maxScore).toBe(4.5);
      // 4.0 / 4.5 = 88.8888... -> 88.89
      expect(result.percentage).toBe(88.89);
      expect(result.passed).toBe(true);
    });

    it("handles precision near boundaries (e.g. 0.1 + 0.2 marks)", () => {
      const q1: StoredAttemptQuestion = { ...mockSingle, id: "q1", marks: 0.1 };
      const q2: StoredAttemptQuestion = { ...mockTF, id: "q2", marks: 0.2 };

      const result = gradeAttempt(
        [q1, q2],
        [
          { questionId: "q1", selectedOptionIds: ["opt-1b"] },
          { questionId: "q2", selectedOptionIds: ["opt-2t"] },
        ],
        100,
      );

      expect(result.score).toBe(0.3);
      expect(result.maxScore).toBe(0.3);
      expect(result.percentage).toBe(100);
      expect(result.passed).toBe(true);
    });

    it("handles zero maxScore gracefully without division by zero or NaN", () => {
      const qZero: StoredAttemptQuestion = { ...mockSingle, id: "qz", marks: 0 };
      const result = gradeAttempt([qZero], [], 50);

      expect(result.score).toBe(0);
      expect(result.maxScore).toBe(0);
      expect(result.percentage).toBe(0);
      expect(result.passed).toBe(false);
      expect(Number.isNaN(result.percentage)).toBe(false);
    });
  });

  describe("isGradeReleased helper", () => {
    it("releases immediately when gradeRelease is on_submit", () => {
      expect(isGradeReleased({ gradeRelease: "on_submit", closesAt: null })).toBe(true);
    });

    it("evaluates closesAt when gradeRelease is on_close", () => {
      const future = new Date(Date.now() + 60_000);
      const past = new Date(Date.now() - 60_000);

      expect(isGradeReleased({ gradeRelease: "on_close", closesAt: future })).toBe(false);
      expect(isGradeReleased({ gradeRelease: "on_close", closesAt: past })).toBe(true);
    });

    it("evaluates all_submitted correctly with fallback to closesAt", () => {
      const future = new Date(Date.now() + 60_000);
      const past = new Date(Date.now() - 60_000);

      // Not all submitted, not closed yet
      expect(isGradeReleased({ gradeRelease: "all_submitted", closesAt: future, allSubmitted: false })).toBe(false);
      // All submitted -> released!
      expect(isGradeReleased({ gradeRelease: "all_submitted", closesAt: future, allSubmitted: true })).toBe(true);
      // Not all submitted, but closesAt passed -> released via fallback!
      expect(isGradeReleased({ gradeRelease: "all_submitted", closesAt: past, allSubmitted: false })).toBe(true);
    });

    it("evaluates manual grade release with gradesReleasedAt", () => {
      const future = new Date(Date.now() + 60_000);
      const past = new Date(Date.now() - 60_000);

      expect(isGradeReleased({ gradeRelease: "manual", closesAt: null, gradesReleasedAt: null })).toBe(false);
      expect(isGradeReleased({ gradeRelease: "manual", closesAt: null, gradesReleasedAt: future })).toBe(false);
      expect(isGradeReleased({ gradeRelease: "manual", closesAt: null, gradesReleasedAt: past })).toBe(true);
    });

    it("overrides other modes when gradesReleasedAt is set in the past", () => {
      const past = new Date(Date.now() - 60_000);
      expect(isGradeReleased({ gradeRelease: "on_close", closesAt: new Date(Date.now() + 999_999), gradesReleasedAt: past })).toBe(true);
    });
  });

  describe("isReviewReleased helper", () => {
    it("follows gradesReleased when reviewReleaseAt is null", () => {
      expect(isReviewReleased({ reviewReleaseAt: null }, false)).toBe(false);
      expect(isReviewReleased({ reviewReleaseAt: null }, true)).toBe(true);
    });

    it("respects explicit reviewReleaseAt regardless of gradesReleased", () => {
      const future = new Date(Date.now() + 60_000);
      const past = new Date(Date.now() - 60_000);

      // Even if grades are released, review is locked if reviewReleaseAt is in future
      expect(isReviewReleased({ reviewReleaseAt: future }, true)).toBe(false);
      // Unlocked when past reviewReleaseAt
      expect(isReviewReleased({ reviewReleaseAt: past }, false)).toBe(true);
    });
  });
});
