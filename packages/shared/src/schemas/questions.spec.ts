import { describe, expect, it } from "vitest";
import { QuestionBankCreateSchema, QuestionCreateSchema } from "./questions.js";

describe("QuestionBank schemas", () => {
  it("validates valid question bank input", () => {
    const valid = QuestionBankCreateSchema.safeParse({
      title: "Midterm Question Bank",
      courseId: "019323f4-1234-7890-abcd-ef0123456789",
    });
    expect(valid.success).toBe(true);
  });

  it("allows null or omitted courseId for global banks", () => {
    const globalBank = QuestionBankCreateSchema.safeParse({
      title: "Global Question Bank",
    });
    expect(globalBank.success).toBe(true);
    if (globalBank.success) {
      expect(globalBank.data.courseId).toBeUndefined();
    }
  });

  it("rejects empty title", () => {
    const invalid = QuestionBankCreateSchema.safeParse({
      title: "   ",
    });
    expect(invalid.success).toBe(false);
  });
});

describe("QuestionCreateSchema", () => {
  describe("single choice", () => {
    it("accepts valid single-choice question with 1 correct option", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "single",
        text: "What is 2 + 2?",
        marks: 2.5,
        difficulty: "easy",
        options: [
          { text: "3", isCorrect: false },
          { text: "4", isCorrect: true },
          { text: "5", isCorrect: false },
        ],
      });
      expect(res.success).toBe(true);
    });

    it("rejects single-choice with 0 correct options", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "single",
        text: "What is 2 + 2?",
        options: [
          { text: "3", isCorrect: false },
          { text: "4", isCorrect: false },
        ],
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/exactly one correct option/i);
      }
    });

    it("rejects single-choice with multiple correct options", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "single",
        text: "What is 2 + 2?",
        options: [
          { text: "4", isCorrect: true },
          { text: "four", isCorrect: true },
        ],
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/exactly one correct option/i);
      }
    });

    it("rejects single-choice with less than 2 options", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "single",
        text: "What is 2 + 2?",
        options: [{ text: "4", isCorrect: true }],
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/at least 2 options/i);
      }
    });
  });

  describe("multiple choice", () => {
    it("accepts multiple-choice with 2 or more correct options", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "multiple",
        text: "Which of the following are prime numbers?",
        marks: 4,
        options: [
          { text: "2", isCorrect: true },
          { text: "3", isCorrect: true },
          { text: "4", isCorrect: false },
        ],
      });
      expect(res.success).toBe(true);
    });

    it("rejects multiple-choice with 0 correct options", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "multiple",
        text: "Prime numbers?",
        options: [
          { text: "4", isCorrect: false },
          { text: "6", isCorrect: false },
        ],
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/at least one correct option/i);
      }
    });
  });

  describe("true/false", () => {
    it("accepts valid true/false with exactly 2 options and 1 correct", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "true_false",
        text: "The Earth is round.",
        options: [
          { text: "صواب", isCorrect: true },
          { text: "خطأ", isCorrect: false },
        ],
      });
      expect(res.success).toBe(true);
    });

    it("rejects true/false with 3 options", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "true_false",
        text: "The Earth is round.",
        options: [
          { text: "True", isCorrect: true },
          { text: "False", isCorrect: false },
          { text: "Maybe", isCorrect: false },
        ],
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/exactly 2 options/i);
      }
    });
  });

  describe("marks and tags constraints", () => {
    it("rejects marks <= 0 or marks > 1000", () => {
      const zeroMarks = QuestionCreateSchema.safeParse({
        type: "single",
        text: "Question?",
        marks: 0,
        options: [
          { text: "A", isCorrect: true },
          { text: "B", isCorrect: false },
        ],
      });
      expect(zeroMarks.success).toBe(false);

      const excessMarks = QuestionCreateSchema.safeParse({
        type: "single",
        text: "Question?",
        marks: 1001,
        options: [
          { text: "A", isCorrect: true },
          { text: "B", isCorrect: false },
        ],
      });
      expect(excessMarks.success).toBe(false);
    });

    it("rejects marks with > 2 decimal places", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "single",
        text: "Question?",
        marks: 1.234,
        options: [
          { text: "A", isCorrect: true },
          { text: "B", isCorrect: false },
        ],
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/at most 2 decimal places/i);
      }
    });

    it("lowercases and limits tags", () => {
      const res = QuestionCreateSchema.safeParse({
        type: "single",
        text: "Question?",
        tags: ["Math", "Algebra"],
        options: [
          { text: "A", isCorrect: true },
          { text: "B", isCorrect: false },
        ],
      });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.tags).toEqual(["math", "algebra"]);
      }
    });
  });
});
