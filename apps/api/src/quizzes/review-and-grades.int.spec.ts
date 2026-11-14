// Step 8.10: Grade Release and Review Modes Integration Tests (FR-X07, FR-X08)
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, AttemptReasonCode, QuizReasonCode, type QuizCreateInput } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("ReviewGradesPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

type Tenant = { id: string; slug: string };
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;

async function setup() {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const assistant = await fx.staffLogin(t, "assistant");

  // Two enrolled students for all_submitted tests
  const student1 = await fx.member(t.id, "student", { maxDevices: 2 });
  const studentLogin1 = await fx.studentLogin(t, student1.user.email);

  const student2 = await fx.member(t.id, "student", { maxDevices: 2 });
  const studentLogin2 = await fx.studentLogin(t, student2.user.email);

  const asTeacher = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: teacher.cookie,
    });

  const asAssistant = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: assistant.cookie,
    });

  const asStudent1 = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: studentLogin1.cookies,
    });

  const asStudent2 = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: studentLogin2.cookies,
    });

  // Create course and publish it
  const courseRes = await asTeacher("POST", "/courses", { title: "Review Modes Test Course" });
  const courseId = (courseRes.body as { id: string }).id;
  await systemPrisma.course.update({ where: { id: courseId }, data: { status: "published" } });

  // Enroll both students
  await systemPrisma.enrollment.create({
    data: {
      tenantId: t.id,
      membershipId: student1.membership.id,
      courseId,
      status: "active",
      source: "invitation",
      grantedBy: teacher.user.id,
    },
  });
  await systemPrisma.enrollment.create({
    data: {
      tenantId: t.id,
      membershipId: student2.membership.id,
      courseId,
      status: "active",
      source: "invitation",
      grantedBy: teacher.user.id,
    },
  });

  // Create Question Bank and 2 questions with explanations
  const bankRes = await asTeacher("POST", "/question-banks", {
    courseId,
    title: "Exam Review Test Bank",
  });
  const bankId = (bankRes.body as { id: string }).id;

  const q1Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "single",
    text: "What is 10 + 10?",
    marks: 5,
    difficulty: "easy",
    explanation: "Basic arithmetic: 10 + 10 = 20.",
    options: [
      { text: "15", isCorrect: false },
      { text: "20", isCorrect: true },
      { text: "25", isCorrect: false },
    ],
  });
  const q1Id = (q1Res.body as { id: string }).id;

  const q2Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "true_false",
    text: "The capital of France is Paris.",
    marks: 5,
    difficulty: "easy",
    explanation: "Paris has been the capital of France since 987 CE.",
    options: [
      { text: "True", isCorrect: true },
      { text: "False", isCorrect: false },
    ],
  });
  const q2Id = (q2Res.body as { id: string }).id;

  // Helper to create & publish a quiz
  const createQuiz = async (overrides: Partial<QuizCreateInput> = {}) => {
    const now = Date.now();
    const payload: QuizCreateInput = {
      courseId,
      title: "Review Test Quiz",
      durationMin: 30,
      passMark: 50,
      maxAttempts: 1,
      selection: "manual",
      questionIds: [q1Id, q2Id],
      shuffleQuestions: false,
      shuffleOptions: false,
      navigation: "free",
      gradeRelease: "on_submit",
      reviewMode: "full",
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 3600_000).toISOString(),
      ...overrides,
    };
    const createRes = await asTeacher("POST", "/quizzes", payload);
    const quizId = (createRes.body as { id: string }).id;
    await asTeacher("POST", `/quizzes/${quizId}/publish`);
    return quizId;
  };

  return {
    t,
    teacher,
    assistant,
    student1,
    student2,
    asTeacher,
    asAssistant,
    asStudent1,
    asStudent2,
    courseId,
    bankId,
    q1Id,
    q2Id,
    createQuiz,
  };
}

describe("Step 8.10: Grade Release and Review Modes (FR-X07, FR-X08)", () => {
  it("releases grades immediately upon submit when gradeRelease is on_submit", async () => {
    const s = await setup();
    const quizId = await s.createQuiz({ gradeRelease: "on_submit", reviewMode: "full" });

    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(startRes.status).toBe(201);
    const attemptId = (startRes.body as { id: string }).id;

    // Snapshot questions
    const q1 = (startRes.body as { questions: Array<{ id: string; options: Array<{ id: string }> }> }).questions[0]!;
    const q1CorrectOpt = q1.options[1]!.id; // "20"

    await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1CorrectOpt],
    });

    const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body).toMatchObject({
      gradesReleased: true,
      score: 5,
      maxScore: 10,
      percentage: 50,
      passed: true,
    });

    const getRes = await s.asStudent1("GET", `/attempts/${attemptId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      gradesReleased: true,
      score: 5,
      percentage: 50,
      passed: true,
    });
  });

  it("masks grades when gradeRelease is on_close until closesAt passes", async () => {
    const s = await setup();
    const quizId = await s.createQuiz({
      gradeRelease: "on_close",
      reviewMode: "full",
      closesAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    const attemptId = (startRes.body as { id: string }).id;

    const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body).toMatchObject({
      gradesReleased: false,
      score: null,
      maxScore: null,
      percentage: null,
      passed: null,
    });

    // Advance closesAt into the past
    await systemPrisma.quiz.update({
      where: { id: quizId },
      data: { closesAt: new Date(Date.now() - 5000) },
    });

    // Reading attempt after closesAt unmasks the score
    const getRes = await s.asStudent1("GET", `/attempts/${attemptId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({
      gradesReleased: true,
      score: 0,
      percentage: 0,
      passed: false,
    });
  });

  it("handles all_submitted: withholds grades until all eligible students submit", async () => {
    const s = await setup();
    // 2 active enrolled students (student1, student2)
    const quizId = await s.createQuiz({
      gradeRelease: "all_submitted",
      reviewMode: "full",
      closesAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    // Student 1 starts and submits
    const start1 = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    const attempt1Id = (start1.body as { id: string }).id;
    const submit1 = await s.asStudent1("POST", `/attempts/${attempt1Id}/submit`);

    // Student 2 has NOT submitted yet -> grades masked
    expect(submit1.body).toMatchObject({
      gradesReleased: false,
      score: null,
    });

    const get1Before = await s.asStudent1("GET", `/attempts/${attempt1Id}`);
    expect(get1Before.body).toMatchObject({
      gradesReleased: false,
      score: null,
    });

    // Student 2 starts and submits
    const start2 = await s.asStudent2("POST", `/quizzes/${quizId}/attempts`);
    const attempt2Id = (start2.body as { id: string }).id;
    const submit2 = await s.asStudent2("POST", `/attempts/${attempt2Id}/submit`);

    // Now ALL eligible students have submitted!
    expect(submit2.body).toMatchObject({
      gradesReleased: true,
    });
    expect((submit2.body as { score: number | null }).score).not.toBeNull();

    // Student 1 now re-checks and also sees unmasked grades
    const get1After = await s.asStudent1("GET", `/attempts/${attempt1Id}`);
    expect(get1After.body).toMatchObject({
      gradesReleased: true,
    });
    expect((get1After.body as { score: number | null }).score).not.toBeNull();
  });

  it("handles all_submitted fallback: releases grades once closesAt passes even if some students never submitted", async () => {
    const s = await setup();
    const quizId = await s.createQuiz({
      gradeRelease: "all_submitted",
      reviewMode: "full",
      closesAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    // Student 1 submits, Student 2 never touches the quiz
    const start1 = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    const attempt1Id = (start1.body as { id: string }).id;
    await s.asStudent1("POST", `/attempts/${attempt1Id}/submit`);

    const beforeClose = await s.asStudent1("GET", `/attempts/${attempt1Id}`);
    expect(beforeClose.body).toMatchObject({ gradesReleased: false, score: null });

    // Backdate closesAt to simulate deadline expiry
    await systemPrisma.quiz.update({
      where: { id: quizId },
      data: { closesAt: new Date(Date.now() - 10_000) },
    });

    // Now close time passed -> fallback kicks in!
    const afterClose = await s.asStudent1("GET", `/attempts/${attempt1Id}`);
    expect(afterClose.body).toMatchObject({ gradesReleased: true });
    expect((afterClose.body as { score: number | null }).score).not.toBeNull();
  });

  it("handles manual grade release: staff endpoint POST /quizzes/:id/release-grades unmasks grades and creates audit entry", async () => {
    const s = await setup();
    const quizId = await s.createQuiz({
      gradeRelease: "manual",
      reviewMode: "full",
      closesAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const start1 = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    const attempt1Id = (start1.body as { id: string }).id;
    await s.asStudent1("POST", `/attempts/${attempt1Id}/submit`);

    // Student cannot trigger grade release
    const studentRelease = await s.asStudent1("POST", `/quizzes/${quizId}/release-grades`);
    expect(studentRelease.status).toBe(403);
    expect(reasonOf(studentRelease.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

    // Grades are still withheld
    const check1 = await s.asStudent1("GET", `/attempts/${attempt1Id}`);
    expect(check1.body).toMatchObject({ gradesReleased: false, score: null });

    // Assistant or Teacher triggers release
    const releaseRes = await s.asAssistant("POST", `/quizzes/${quizId}/release-grades`);
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body).toMatchObject({
      success: true,
      quizId,
    });
    expect((releaseRes.body as { gradesReleasedAt: string }).gradesReleasedAt).toBeTruthy();

    // Grades are now released!
    const check2 = await s.asStudent1("GET", `/attempts/${attempt1Id}`);
    expect(check2.body).toMatchObject({ gradesReleased: true });
    expect((check2.body as { score: number | null }).score).not.toBeNull();

    // Verify audit log
    const auditLogs = await systemPrisma.auditLog.findMany({
      where: { targetId: quizId, action: "quiz.release_grades" },
    });
    expect(auditLogs.length).toBeGreaterThanOrEqual(1);
  });

  describe("Review Modes (FR-X08)", () => {
    it("enforces reviewMode 'grade': returns aggregate grade only and null questions array", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({ gradeRelease: "on_submit", reviewMode: "grade" });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;
      await s.asStudent1("POST", `/attempts/${attemptId}/submit`);

      const reviewRes = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body).toMatchObject({
        attemptId,
        quizId,
        reviewMode: "grade",
        score: 0,
        maxScore: 10,
        percentage: 0,
        passed: false,
        questions: null,
      });
      // Zero answer keys or explanations leaked
      expect(JSON.stringify(reviewRes.body)).not.toContain("explanation");
      expect(JSON.stringify(reviewRes.body)).not.toContain("isCorrect");
    });

    it("enforces reviewMode 'grade_answers': returns questions with correct options and student choices, but null explanations", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({ gradeRelease: "on_submit", reviewMode: "grade_answers" });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      const q1 = (startRes.body as { questions: Array<{ id: string; options: Array<{ id: string }> }> }).questions[0]!;
      const q1Opt = q1.options[1]!.id; // "20" (correct)
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [q1Opt],
      });

      await s.asStudent1("POST", `/attempts/${attemptId}/submit`);

      const reviewRes = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body).toMatchObject({
        attemptId,
        quizId,
        reviewMode: "grade_answers",
        score: 5,
        maxScore: 10,
        percentage: 50,
        passed: true,
      });

      const questions = (reviewRes.body as { questions: Array<Record<string, unknown>> }).questions;
      expect(questions).toHaveLength(2);

      const reviewedQ1 = questions[0]!;
      expect(reviewedQ1.selectedOptionIds).toEqual([q1Opt]);
      expect(reviewedQ1.isCorrect).toBe(true);
      expect(reviewedQ1.marksAwarded).toBe(5);
      // Explanations MUST be stripped (null)
      expect(reviewedQ1.explanation).toBeNull();

      // Options must reveal isCorrect
      const options = reviewedQ1.options as Array<{ id: string; isCorrect: boolean }>;
      expect(options.some((o) => o.isCorrect === true)).toBe(true);
      expect(JSON.stringify(reviewRes.body)).not.toContain("Basic arithmetic");
    });

    it("enforces reviewMode 'full': returns questions with correct options and author explanations", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({ gradeRelease: "on_submit", reviewMode: "full" });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      const q1 = (startRes.body as { questions: Array<{ id: string; options: Array<{ id: string }> }> }).questions[0]!;
      const q1Opt = q1.options[1]!.id;
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [q1Opt],
      });

      await s.asStudent1("POST", `/attempts/${attemptId}/submit`);

      const reviewRes = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body).toMatchObject({
        attemptId,
        quizId,
        reviewMode: "full",
        score: 5,
      });

      const questions = (reviewRes.body as { questions: Array<Record<string, unknown>> }).questions;
      expect(questions[0]!.explanation).toBe("Basic arithmetic: 10 + 10 = 20.");
      expect(questions[1]!.explanation).toBe("Paris has been the capital of France since 987 CE.");
    });

    it("blocks review with 403 REVIEW_NOT_RELEASED when reviewReleaseAt is in the future", async () => {
      const s = await setup();
      const futureReviewTime = new Date(Date.now() + 3600_000);
      const quizId = await s.createQuiz({
        gradeRelease: "on_submit",
        reviewMode: "full",
        reviewReleaseAt: futureReviewTime.toISOString(),
      });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;
      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);

      // Grades are released immediately
      expect(submitRes.body).toMatchObject({ gradesReleased: true, score: 0 });

      // But review is locked
      const reviewLocked = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(reviewLocked.status).toBe(403);
      expect(reasonOf(reviewLocked.body)).toBe(AttemptReasonCode.REVIEW_NOT_RELEASED);

      // Backdate reviewReleaseAt in DB
      await systemPrisma.quiz.update({
        where: { id: quizId },
        data: { reviewReleaseAt: new Date(Date.now() - 5000) },
      });

      // Review now unlocks!
      const reviewUnlocked = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(reviewUnlocked.status).toBe(200);
      expect(reviewUnlocked.body).toMatchObject({ reviewMode: "full" });
    });

    it("rejects review requests for in-progress attempts with 400 ATTEMPT_NOT_SUBMITTED", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({ gradeRelease: "on_submit", reviewMode: "full" });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      const reviewRes = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(reviewRes.status).toBe(400);
      expect(reasonOf(reviewRes.body)).toBe(AttemptReasonCode.ATTEMPT_NOT_SUBMITTED);
    });

    it("allows staff (teacher, assistant) to view full review anytime even before release", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({
        gradeRelease: "manual",
        reviewMode: "grade", // Even if student review is configured to "grade" only
        reviewReleaseAt: new Date(Date.now() + 3600_000).toISOString(),
      });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;
      await s.asStudent1("POST", `/attempts/${attemptId}/submit`);

      // Student is blocked (grades manual, review in future)
      const studentReview = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(studentReview.status).toBe(403);

      // Teacher can review attempt in full mode with explanations
      const teacherReview = await s.asTeacher("GET", `/attempts/${attemptId}/review`);
      expect(teacherReview.status).toBe(200);
      expect(teacherReview.body).toMatchObject({
        attemptId,
        reviewMode: "full",
      });
      const q = (teacherReview.body as { questions: Array<Record<string, unknown>> }).questions;
      expect(q[0]!.explanation).toBe("Basic arithmetic: 10 + 10 = 20.");

      // Assistant can also review attempt
      const assistantReview = await s.asAssistant("GET", `/attempts/${attemptId}/review`);
      expect(assistantReview.status).toBe(200);
      expect(assistantReview.body).toMatchObject({ attemptId, reviewMode: "full" });
    });

    it("enforces tenant isolation and student ownership on review endpoint", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({ gradeRelease: "on_submit", reviewMode: "full" });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;
      await s.asStudent1("POST", `/attempts/${attemptId}/submit`);

      // Student 2 cannot review Student 1's attempt (404)
      const student2Review = await s.asStudent2("GET", `/attempts/${attemptId}/review`);
      expect(student2Review.status).toBe(404);
      expect(reasonOf(student2Review.body)).toBe(AttemptReasonCode.ATTEMPT_NOT_FOUND);

      // Other tenant cannot review or release grades
      const tOther = await fx.tenant();
      const teacherOther = await fx.staffLogin(tOther, "teacher");

      const otherReview = await http.send(`${tOther.slug}.localhost`, "GET", `/api/attempts/${attemptId}/review`, undefined, {
        cookie: teacherOther.cookie,
      });
      expect(otherReview.status).toBe(404);

      const otherRelease = await http.send(`${tOther.slug}.localhost`, "POST", `/api/quizzes/${quizId}/release-grades`, undefined, {
        cookie: teacherOther.cookie,
      });
      expect(otherRelease.status).toBe(404);
    });
  });
});
