import { describe, expect, it } from "vitest";
import { QuizCreateSchema, QuizUpdateSchema } from "./quizzes.js";

describe("QuizCreateSchema", () => {
  const baseValid = {
    courseId: "019323f4-1234-7890-abcd-ef0123456789",
    title: "Midterm Exam",
    durationMin: 60,
    passMark: 70,
    opensAt: "2026-12-01T10:00:00.000Z",
  };

  it("accepts valid manual quiz without closesAt (open-ended)", () => {
    const res = QuizCreateSchema.safeParse(baseValid);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.selection).toBe("manual");
      expect(res.data.maxAttempts).toBe(1);
      expect(res.data.navigation).toBe("free");
      expect(res.data.gradeRelease).toBe("on_submit");
      expect(res.data.reviewMode).toBe("full");
      expect(res.data.closesAt).toBeUndefined();
    }
  });

  it("accepts valid manual quiz with valid closesAt window >= durationMin", () => {
    const res = QuizCreateSchema.safeParse({
      ...baseValid,
      closesAt: "2026-12-01T11:00:00.000Z", // Exactly 60 min
    });
    expect(res.success).toBe(true);
  });

  it("accepts manual quiz with questions and targets", () => {
    const res = QuizCreateSchema.safeParse({
      ...baseValid,
      questionIds: ["019323f4-1234-7890-abcd-ef0123456789"],
      targetContentItemIds: ["019323f4-0000-7890-abcd-ef0123456789"],
    });
    expect(res.success).toBe(true);
  });

  it("rejects closesAt that is shorter than durationMin", () => {
    const res = QuizCreateSchema.safeParse({
      ...baseValid,
      closesAt: "2026-12-01T10:59:00.000Z", // 59 min < 60 min
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toMatch(/durationMin after opening time/i);
    }
  });

  it("rejects closesAt that is before opensAt", () => {
    const res = QuizCreateSchema.safeParse({
      ...baseValid,
      closesAt: "2026-12-01T09:00:00.000Z",
    });
    expect(res.success).toBe(false);
  });

  it("accepts valid random selection quiz", () => {
    const res = QuizCreateSchema.safeParse({
      ...baseValid,
      selection: "random",
      randomCount: 10,
      randomBankIds: ["019323f4-1234-7890-abcd-ef0123456789"],
    });
    expect(res.success).toBe(true);
  });

  it("rejects random selection quiz with empty randomBankIds", () => {
    const res = QuizCreateSchema.safeParse({
      ...baseValid,
      selection: "random",
      randomCount: 10,
      randomBankIds: [],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toMatch(/at least one question bank/i);
    }
  });

  it("rejects random selection quiz with missing randomCount", () => {
    const res = QuizCreateSchema.safeParse({
      ...baseValid,
      selection: "random",
      randomBankIds: ["019323f4-1234-7890-abcd-ef0123456789"],
    });
    expect(res.success).toBe(false);
  });

  it("rejects passMark greater than 100 or less than 0", () => {
    expect(QuizCreateSchema.safeParse({ ...baseValid, passMark: 105 }).success).toBe(false);
    expect(QuizCreateSchema.safeParse({ ...baseValid, passMark: -5 }).success).toBe(false);
  });
});

describe("QuizUpdateSchema", () => {
  it("rejects empty update object", () => {
    const res = QuizUpdateSchema.safeParse({});
    expect(res.success).toBe(false);
  });

  it("accepts partial updates", () => {
    const res = QuizUpdateSchema.safeParse({
      title: "Updated Title",
      passMark: 80,
    });
    expect(res.success).toBe(true);
  });

  it("rejects random selection with empty randomBankIds", () => {
    const res = QuizUpdateSchema.safeParse({
      selection: "random",
      randomBankIds: [],
    });
    expect(res.success).toBe(false);
  });
});
