import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "Checkpoint8Password123!";
const fx = studentFixtures(PASSWORD);
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await systemPrisma.auditLog.deleteMany({
    where: {
      action: {
        in: [
          "quiz.create",
          "quiz.publish",
          "quiz.release_grades",
          "attempt.start",
          "attempt.submit",
          "attempt.extend_time",
          "attempt.move_device",
          "enrollment.grant",
        ],
      },
    },
  });
  await systemPrisma.tenant.deleteMany({
    where: { slug: { startsWith: "chk8-" } },
  });
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

type Tenant = { id: string; slug: string };
const host = (t: Tenant) => `${t.slug}.localhost`;
const as = (t: Tenant, cookie: string, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body, { cookie });

describe("API Checkpoint 8: Full End-to-End Exam Lifecycle (Track A Milestone)", () => {
  it("runs full exam lifecycle end to end through the API: create, publish, take, rescue, grade, and review release", async () => {
    // -------------------------------------------------------------
    // 1. Setup Tenant, Course, and Staff
    // -------------------------------------------------------------
    const slug = `chk8-${randomUUID().slice(0, 8)}`;
    const tenantRow = await systemPrisma.tenant.create({
      data: { slug, name: "Checkpoint 8 Academy", status: "active" },
    });
    const t = { id: tenantRow.id, slug: tenantRow.slug };

    const teacher = await fx.staffLogin(t, "teacher");

    const courseRes = await as(t, teacher.cookie, "POST", "/courses", {
      title: "Advanced Mathematics",
      description: "University preparation math course",
    });
    expect(courseRes.status).toBe(201);
    const courseId = (courseRes.body as { id: string }).id;

    // Publish course
    await as(t, teacher.cookie, "POST", `/courses/${courseId}/publish`);

    // -------------------------------------------------------------
    // 2. Question Bank & Questions Creation (FR-X01)
    // -------------------------------------------------------------
    const bankRes = await as(t, teacher.cookie, "POST", "/question-banks", {
      courseId,
      title: "Calculus & Algebra Bank",
    });
    expect(bankRes.status).toBe(201);
    const bankId = (bankRes.body as { id: string }).id;

    // Question 1: Single Choice (2 marks)
    const q1Res = await as(t, teacher.cookie, "POST", `/question-banks/${bankId}/questions`, {
      type: "single",
      text: "What is the derivative of x^2?",
      marks: 2,
      explanation: "By power rule, d/dx(x^2) = 2x.",
      options: [
        { text: "2x", isCorrect: true, sortOrder: 0 },
        { text: "x", isCorrect: false, sortOrder: 1 },
        { text: "x^3 / 3", isCorrect: false, sortOrder: 2 },
      ],
    });
    expect(q1Res.status).toBe(201);
    const q1Id = (q1Res.body as { id: string }).id;

    // Question 2: Multiple Choice (3 marks)
    const q2Res = await as(t, teacher.cookie, "POST", `/question-banks/${bankId}/questions`, {
      type: "multiple",
      text: "Which of the following numbers are prime?",
      marks: 3,
      explanation: "2 and 3 are prime; 4 is composite.",
      options: [
        { text: "2", isCorrect: true, sortOrder: 0 },
        { text: "3", isCorrect: true, sortOrder: 1 },
        { text: "4", isCorrect: false, sortOrder: 2 },
      ],
    });
    expect(q2Res.status).toBe(201);
    const q2Id = (q2Res.body as { id: string }).id;

    // Question 3: True / False (1 mark)
    const q3Res = await as(t, teacher.cookie, "POST", `/question-banks/${bankId}/questions`, {
      type: "true_false",
      text: "The square root of 16 is 4.",
      marks: 1,
      explanation: "sqrt(16) = 4.",
      options: [
        { text: "True", isCorrect: true, sortOrder: 0 },
        { text: "False", isCorrect: false, sortOrder: 1 },
      ],
    });
    expect(q3Res.status).toBe(201);
    const q3Id = (q3Res.body as { id: string }).id;

    // -------------------------------------------------------------
    // 3. Quiz Configuration & Publishing (FR-X02, FR-X03)
    // -------------------------------------------------------------
    const now = new Date();
    const quizRes = await as(t, teacher.cookie, "POST", "/quizzes", {
      courseId,
      title: "Midterm Mathematics Exam",
      durationMin: 45,
      passMark: 3,
      maxAttempts: 2,
      selection: "manual",
      navigation: "free",
      gradeRelease: "manual", // Withheld until teacher manual release
      reviewMode: "full",
      reviewReleaseAt: new Date(now.getTime() + 7200_000).toISOString(), // Released in 2 hours
      opensAt: new Date(now.getTime() - 60_000).toISOString(),
      closesAt: new Date(now.getTime() + 86400_000).toISOString(),
      questionIds: [q1Id, q2Id, q3Id],
    });
    expect(quizRes.status).toBe(201);
    const quizId = (quizRes.body as { id: string }).id;

    // Publish quiz
    const publishRes = await as(t, teacher.cookie, "POST", `/quizzes/${quizId}/publish`);
    expect(publishRes.status).toBe(200);

    // -------------------------------------------------------------
    // 4. Student Device Enrollment & Authentic Sign-In (ADR-011)
    // -------------------------------------------------------------
    const studentUser = await fx.user();
    const studentMember = await systemPrisma.membership.create({
      data: { tenantId: t.id, userId: studentUser.id, role: "student" },
    });

    // Enroll student in course
    await systemPrisma.enrollment.create({
      data: {
        tenantId: t.id,
        membershipId: studentMember.id,
        courseId,
        status: "active",
        source: "manual",
        grantedBy: teacher.user.id,
      },
    });

    // Student authentic login with device registration
    const studentDev = await fx.device(studentUser.id, "active");
    const studentLogin = await fx.studentLogin(t, studentUser.email, studentDev.cookie);
    expect(studentLogin.status).toBe(200);
    const studentCookie = studentLogin.cookies;

    // -------------------------------------------------------------
    // 5. Start Attempt (FR-X05, FR-X10)
    // -------------------------------------------------------------
    const startRes = await as(t, studentCookie, "POST", `/quizzes/${quizId}/attempts`);
    expect(startRes.status).toBe(201);
    const attemptBody = startRes.body as {
      id: string;
      attemptNo: number;
      durationMin: number;
      maxScore: number;
      questions: Array<{
        id: string;
        text: string;
        type: string;
        marks: number;
        options: Array<{ id: string; text: string }>;
      }>;
    };
    const attemptId = attemptBody.id;
    expect(attemptBody.attemptNo).toBe(1);
    expect(attemptBody.maxScore).toBe(6); // 2 + 3 + 1
    expect(attemptBody.questions).toHaveLength(3);

    // Verify zero answer leakage (FR-X08)
    for (const q of attemptBody.questions) {
      expect((q as any).explanation).toBeUndefined();
      for (const opt of q.options) {
        expect((opt as any).isCorrect).toBeUndefined();
      }
    }

    // -------------------------------------------------------------
    // 6. Autosave Student Answers (FR-X04)
    // -------------------------------------------------------------
    const sq1 = attemptBody.questions.find((q) => q.type === "single")!;
    const sq1CorrectOpt = sq1.options.find((o) => o.text === "2x")!;
    const ans1Res = await as(t, studentCookie, "PUT", `/attempts/${attemptId}/answers/${sq1.id}`, {
      selectedOptionIds: [sq1CorrectOpt.id],
    });
    expect(ans1Res.status).toBe(200);

    const sq2 = attemptBody.questions.find((q) => q.type === "multiple")!;
    const sq2Opt2 = sq2.options.find((o) => o.text === "2")!;
    const sq2Opt3 = sq2.options.find((o) => o.text === "3")!;
    const ans2Res = await as(t, studentCookie, "PUT", `/attempts/${attemptId}/answers/${sq2.id}`, {
      selectedOptionIds: [sq2Opt2.id, sq2Opt3.id],
    });
    expect(ans2Res.status).toBe(200);

    const sq3 = attemptBody.questions.find((q) => q.type === "true_false")!;
    const sq3OptTrue = sq3.options.find((o) => o.text.toLowerCase() === "true")!;
    const ans3Res = await as(t, studentCookie, "PUT", `/attempts/${attemptId}/answers/${sq3.id}`, {
      selectedOptionIds: [sq3OptTrue.id],
    });
    expect(ans3Res.status).toBe(200);

    // -------------------------------------------------------------
    // 7. Staff Rescue Action: Extend Time (FR-X09)
    // -------------------------------------------------------------
    const extendRes = await as(t, teacher.cookie, "POST", `/attempts/${attemptId}/extend-time`, {
      extraMinutes: 15,
      reason: "Compensating for classroom connectivity disruption",
    });
    expect(extendRes.status).toBe(200);
    expect((extendRes.body as any).extraTimeSec).toBe(900);

    // -------------------------------------------------------------
    // 8. Submit Attempt & Grade Masking (FR-X06, FR-X07)
    // -------------------------------------------------------------
    const submitRes = await as(t, studentCookie, "POST", `/attempts/${attemptId}/submit`);
    expect(submitRes.status).toBe(200);
    const submitBody = submitRes.body as {
      status: string;
      gradesReleased: boolean;
      score: number | null;
      maxScore: number | null;
      passed: boolean | null;
    };
    expect(submitBody.status).toBe("submitted");
    expect(submitBody.gradesReleased).toBe(false);
    expect(submitBody.score).toBeNull(); // Masked because gradeRelease is 'manual'
    expect(submitBody.passed).toBeNull();

    // Verify student cannot view review before release
    const blockedReviewRes = await as(t, studentCookie, "GET", `/attempts/${attemptId}/review`);
    expect(blockedReviewRes.status).toBe(403);

    // -------------------------------------------------------------
    // 9. Manual Grade Release by Teacher (FR-X07)
    // -------------------------------------------------------------
    const releaseRes = await as(t, teacher.cookie, "POST", `/quizzes/${quizId}/release-grades`);
    expect(releaseRes.status).toBe(200);
    expect((releaseRes.body as any).success).toBe(true);
    expect((releaseRes.body as any).gradesReleasedAt).toBeDefined();

    // Student checks attempt: now unmasked!
    const updatedAttemptRes = await as(t, studentCookie, "GET", `/attempts/${attemptId}`);
    expect(updatedAttemptRes.status).toBe(200);
    const updatedBody = updatedAttemptRes.body as {
      gradesReleased: boolean;
      score: number;
      maxScore: number;
      percentage: number;
      passed: boolean;
    };
    expect(updatedBody.gradesReleased).toBe(true);
    expect(updatedBody.score).toBe(6); // 2 + 3 + 1 = 6 full marks
    expect(updatedBody.maxScore).toBe(6);
    expect(updatedBody.percentage).toBe(100);
    expect(updatedBody.passed).toBe(true);

    // -------------------------------------------------------------
    // 10. Review Release Time Arrival (FR-X08)
    // -------------------------------------------------------------
    // Simulate passage of time for reviewReleaseAt in DB
    await systemPrisma.quiz.update({
      where: { id: quizId },
      data: { reviewReleaseAt: new Date(Date.now() - 5_000) },
    });

    const fullReviewRes = await as(t, studentCookie, "GET", `/attempts/${attemptId}/review`);
    expect(fullReviewRes.status).toBe(200);
    const reviewBody = fullReviewRes.body as {
      attemptId: string;
      score: number;
      questions: Array<{
        id: string;
        explanation: string | null;
        options: Array<{ id: string; text: string; isCorrect: boolean }>;
      }>;
    };
    expect(reviewBody.score).toBe(6);
    expect(reviewBody.questions).toHaveLength(3);

    // Author explanations and correct answers now visible!
    const rq1 = reviewBody.questions.find((q) => q.id === sq1.id)!;
    expect(rq1.explanation).toContain("power rule");
    const correctOpt = rq1.options.find((o) => o.text === "2x")!;
    expect(correctOpt.isCorrect).toBe(true);

    // -------------------------------------------------------------
    // 11. Complete Audit Trail Verification (FR-L01)
    // -------------------------------------------------------------
    const auditEntries = await systemPrisma.auditLog.findMany({
      where: { tenantId: t.id },
      orderBy: { createdAt: "asc" },
    });
    const actions = auditEntries.map((a) => a.action);

    expect(actions).toContain("quiz.publish");
    expect(actions).toContain("attempt.start");
    expect(actions).toContain("attempt.extend_time");
    expect(actions).toContain("attempt.submit");
    expect(actions).toContain("quiz.release_grades");
  });
});
