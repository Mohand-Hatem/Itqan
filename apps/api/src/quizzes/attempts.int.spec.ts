// Step 8.5: Attempt start API integration tests (FR-X05, FR-X10)
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, AttemptReasonCode, type QuizCreateInput } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("AttemptsTestPassword123!");
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

  // Student with maxDevices = 2
  const studentMember = await fx.member(t.id, "student", { maxDevices: 2 });
  const studentLogin1 = await fx.studentLogin(t, studentMember.user.email);

  // Another student member who is NOT enrolled
  const unenrolledStudent = await fx.member(t.id, "student");
  const unenrolledLogin = await fx.studentLogin(t, unenrolledStudent.user.email);

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

  const asUnenrolled = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: unenrolledLogin.cookies,
    });

  // Create course
  const courseRes = await asTeacher("POST", "/courses", { title: "Attempt Quiz Course" });
  const courseId = (courseRes.body as { id: string }).id;

  // Enroll student 1 in course
  await systemPrisma.enrollment.create({
    data: {
      tenantId: t.id,
      membershipId: studentMember.membership.id,
      courseId,
      status: "active",
      source: "invitation",
      grantedBy: teacher.user.id,
    },
  });

  // Create question bank
  const bankRes = await asTeacher("POST", "/question-banks", {
    title: "Attempt Question Bank",
    courseId,
  });
  const bankId = (bankRes.body as { id: string }).id;

  // Question 1: single choice with explanation
  const q1Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "single",
    text: "Question 1: What is 2 + 2?",
    marks: 2,
    difficulty: "easy",
    explanation: "2 + 2 is 4 because arithmetic.",
    options: [
      { text: "3", isCorrect: false },
      { text: "4", isCorrect: true },
      { text: "5", isCorrect: false },
    ],
  });
  const q1Id = (q1Res.body as { id: string }).id;

  // Question 2: multiple choice with explanation
  const q2Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "multiple",
    text: "Question 2: Select prime numbers",
    marks: 3,
    difficulty: "medium",
    explanation: "2 and 3 are prime numbers.",
    options: [
      { text: "2", isCorrect: true },
      { text: "3", isCorrect: true },
      { text: "4", isCorrect: false },
    ],
  });
  const q2Id = (q2Res.body as { id: string }).id;

  // Question 3: true_false question
  const q3Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "true_false",
    text: "Question 3: Water boils at 100C at 1 atm.",
    marks: 1,
    difficulty: "easy",
    explanation: "Standard atmospheric boiling point of water is 100C.",
    options: [
      { text: "True", isCorrect: true },
      { text: "False", isCorrect: false },
    ],
  });
  const q3Id = (q3Res.body as { id: string }).id;

  // Helper to create and publish a quiz
  const createAndPublishQuiz = async (overrides: Partial<QuizCreateInput> = {}) => {
    const now = Date.now();
    const createRes = await asTeacher("POST", "/quizzes", {
      courseId,
      title: "Test Quiz",
      durationMin: 30,
      passMark: 50,
      maxAttempts: 1,
      selection: "manual",
      questionIds: [q1Id, q2Id, q3Id],
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 3_600_000).toISOString(),
      ...overrides,
    });
    const quizId = (createRes.body as { id: string }).id;
    await asTeacher("POST", `/quizzes/${quizId}/publish`);
    return quizId;
  };

  return {
    t,
    teacher,
    assistant,
    studentMember,
    asTeacher,
    asAssistant,
    asStudent1,
    asUnenrolled,
    courseId,
    bankId,
    q1Id,
    q2Id,
    q3Id,
    createAndPublishQuiz,
  };
}

describe("Attempts API (Step 8.5)", () => {
  it("starts attempt successfully (201) and returns sanitized response without answer key or explanations", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    const res = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(res.status).toBe(201);

    const body = res.body as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.quizId).toBe(quizId);
    expect(body.attemptNo).toBe(1);
    expect(body.status).toBe("in_progress");
    expect(body.resumed).toBe(false);
    expect(body.serverTime).toBeDefined();
    expect(body.remainingSeconds).toBeGreaterThan(0);
    expect(body.remainingSeconds).toBeLessThanOrEqual(30 * 60);
    expect(body.maxScore).toBe(6); // 2 + 3 + 1
    expect(body.totalQuestions).toBe(3);

    const questions = body.questions as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(3);

    // Verify answer key stripping (CRITICAL SECURITY INVARIANT)
    for (const q of questions) {
      expect(q).not.toHaveProperty("explanation");
      const options = q.options as Array<Record<string, unknown>>;
      expect(options.length).toBeGreaterThanOrEqual(2);
      for (const opt of options) {
        expect(opt).toHaveProperty("id");
        expect(opt).toHaveProperty("text");
        expect(opt).not.toHaveProperty("isCorrect");
        expect(opt).not.toHaveProperty("sortOrder");
      }
    }

    // Verify two-tier snapshot in DB: complete ground truth IS stored in DB
    const dbAttempt = await systemPrisma.attempt.findUniqueOrThrow({
      where: { id: body.id as string },
    });
    const dbSnapshot = dbAttempt.snapshot as {
      questions: Array<{
        explanation: string | null;
        options: Array<{ isCorrect: boolean }>;
      }>;
    };
    expect(dbSnapshot.questions[0]?.explanation).toBe("2 + 2 is 4 because arithmetic.");
    expect(dbSnapshot.questions[0]?.options.some((o) => o.isCorrect)).toBe(true);

    // Verify audit log entry
    const audit = await systemPrisma.auditLog.findFirst({
      where: { action: "attempt.start", targetId: body.id as string },
    });
    expect(audit).toBeDefined();
    expect(audit?.tenantId).toBe(s.t.id);
  });

  it("hard-clips deadlineAt to closesAt when quiz ends before durationMin expires", async () => {
    const s = await setup();
    const now = Date.now();
    const opensAtDate = new Date(now - 105 * 60 * 1000); // opened 105 min ago
    const closesAtDate = new Date(now + 15 * 60 * 1000); // closes in 15 min (window = 120 min >= durationMin 60)
    const quizId = await s.createAndPublishQuiz({
      durationMin: 60, // 60 min nominal duration
      opensAt: opensAtDate.toISOString(),
      closesAt: closesAtDate.toISOString(),
    });

    const res = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(res.status).toBe(201);

    const body = res.body as { deadlineAt: string; remainingSeconds: number };
    const returnedDeadline = new Date(body.deadlineAt).getTime();
    expect(Math.abs(returnedDeadline - closesAtDate.getTime())).toBeLessThan(2000);
    expect(body.remainingSeconds).toBeLessThanOrEqual(15 * 60);
    expect(body.remainingSeconds).toBeGreaterThan(14 * 60);
  });

  it("enforces time windows (QUIZ_NOT_OPEN, QUIZ_CLOSED, QUIZ_NOT_PUBLISHED)", async () => {
    const s = await setup();
    const now = Date.now();

    // 1. Future quiz
    const futureQuizRes = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Future Quiz",
      durationMin: 20,
      passMark: 50,
      maxAttempts: 1,
      selection: "manual",
      questionIds: [s.q1Id],
      opensAt: new Date(now + 3600_000).toISOString(),
      closesAt: new Date(now + 7200_000).toISOString(),
    });
    const futureQuizId = (futureQuizRes.body as { id: string }).id;
    await s.asTeacher("POST", `/quizzes/${futureQuizId}/publish`);

    const futureAttempt = await s.asStudent1("POST", `/quizzes/${futureQuizId}/attempts`);
    expect(futureAttempt.status).toBe(400);
    expect(reasonOf(futureAttempt.body)).toBe(AttemptReasonCode.QUIZ_NOT_OPEN);

    // 2. Closed quiz
    const closedQuizRes = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Past Quiz",
      durationMin: 20,
      passMark: 50,
      maxAttempts: 1,
      selection: "manual",
      questionIds: [s.q1Id],
      opensAt: new Date(now - 7200_000).toISOString(),
      closesAt: new Date(now - 1000).toISOString(),
    });
    const closedQuizId = (closedQuizRes.body as { id: string }).id;
    await s.asTeacher("POST", `/quizzes/${closedQuizId}/publish`);

    const closedAttempt = await s.asStudent1("POST", `/quizzes/${closedQuizId}/attempts`);
    expect(closedAttempt.status).toBe(400);
    expect(reasonOf(closedAttempt.body)).toBe(AttemptReasonCode.QUIZ_CLOSED);

    // 3. Unpublished quiz
    const draftQuizRes = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Draft Quiz",
      durationMin: 20,
      passMark: 50,
      maxAttempts: 1,
      selection: "manual",
      questionIds: [s.q1Id],
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 3600_000).toISOString(),
    });
    const draftQuizId = (draftQuizRes.body as { id: string }).id;

    const draftAttempt = await s.asStudent1("POST", `/quizzes/${draftQuizId}/attempts`);
    expect(draftAttempt.status).toBe(400);
    expect(reasonOf(draftAttempt.body)).toBe(AttemptReasonCode.QUIZ_NOT_PUBLISHED);
  });

  it("rejects unenrolled student with 403 ENROLLMENT_REQUIRED", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    const res = await s.asUnenrolled("POST", `/quizzes/${quizId}/attempts`);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AttemptReasonCode.ENROLLMENT_REQUIRED);
  });

  it("blocks staff members from student attempt endpoints with 403 ROLE_FORBIDDEN", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    const teacherRes = await s.asTeacher("POST", `/quizzes/${quizId}/attempts`);
    expect(teacherRes.status).toBe(403);
    expect(reasonOf(teacherRes.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

    const assistantRes = await s.asAssistant("POST", `/quizzes/${quizId}/attempts`);
    expect(assistantRes.status).toBe(403);
    expect(reasonOf(assistantRes.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
  });

  it("idempotently returns existing in-progress attempt with 200 OK and resumed: true", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    const first = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(first.status).toBe(201);
    const firstBody = first.body as { id: string; resumed: boolean };
    expect(firstBody.resumed).toBe(false);

    // Call again with same student on same device
    const second = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(second.status).toBe(200);
    const secondBody = second.body as { id: string; resumed: boolean };
    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.resumed).toBe(true);
  });

  it("enforces device lock on active attempt: blocks different device with 403 ATTEMPT_DEVICE_MISMATCH", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    // Start attempt on Device 1
    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(startRes.status).toBe(201);
    const attemptId = (startRes.body as { id: string }).id;

    // Student 1 can fetch their attempt on Device 1
    const getRes1 = await s.asStudent1("GET", `/attempts/${attemptId}`);
    expect(getRes1.status).toBe(200);

    // Student signs out / ends session on Device 1 and logs into Device 2
    await systemPrisma.session.deleteMany({ where: { userId: s.studentMember.user.id } });
    const dev2 = await fx.device(s.studentMember.user.id);
    const studentLogin2 = await fx.studentLogin(s.t, s.studentMember.user.email, dev2.cookie);
    expect(studentLogin2.status).toBe(200);

    const asStudent2 = (method: string, path: string, body?: unknown) =>
      http.send(`${s.t.slug}.localhost`, method, `/api${path}`, body, {
        cookie: studentLogin2.cookies,
      });

    // Same student trying to resume active attempt from Device 2 -> 403 ATTEMPT_DEVICE_MISMATCH
    const resumeRes2 = await asStudent2("POST", `/quizzes/${quizId}/attempts`);
    expect(resumeRes2.status).toBe(403);
    expect(reasonOf(resumeRes2.body)).toBe(AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH);

    // Same student trying to GET active attempt from Device 2 -> 403 ATTEMPT_DEVICE_MISMATCH
    const getRes2 = await asStudent2("GET", `/attempts/${attemptId}`);
    expect(getRes2.status).toBe(403);
    expect(reasonOf(getRes2.body)).toBe(AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH);

    // Once attempt is submitted (no longer active), device lock is lifted
    await systemPrisma.attempt.update({
      where: { id: attemptId },
      data: { submittedAt: new Date() },
    });

    const getResAfterSubmit = await asStudent2("GET", `/attempts/${attemptId}`);
    expect(getResAfterSubmit.status).toBe(200);
  });

  it("enforces maxAttempts limit: 403 MAX_ATTEMPTS_REACHED once limit exhausted", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz({ maxAttempts: 1 });

    // Start attempt 1
    const res1 = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(res1.status).toBe(201);
    const attemptId1 = (res1.body as { id: string }).id;

    // Submit attempt 1
    await systemPrisma.attempt.update({
      where: { id: attemptId1 },
      data: { submittedAt: new Date() },
    });

    // Attempting to start attempt 2 when maxAttempts = 1 -> 403 MAX_ATTEMPTS_REACHED
    const res2 = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(res2.status).toBe(403);
    expect(reasonOf(res2.body)).toBe(AttemptReasonCode.MAX_ATTEMPTS_REACHED);
  });

  it("handles true_false fixed order invariant and random question bank selection", async () => {
    const s = await setup();

    // Random quiz selecting 2 questions with shuffleOptions enabled
    const randomQuizRes = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Random Shuffle Quiz",
      durationMin: 25,
      passMark: 60,
      maxAttempts: 2,
      selection: "random",
      randomBankIds: [s.bankId],
      randomCount: 2,
      shuffleQuestions: true,
      shuffleOptions: true,
      opensAt: new Date(Date.now() - 60_000).toISOString(),
      closesAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const randomQuizId = (randomQuizRes.body as { id: string }).id;
    await s.asTeacher("POST", `/quizzes/${randomQuizId}/publish`);

    const startRandom = await s.asStudent1("POST", `/quizzes/${randomQuizId}/attempts`);
    expect(startRandom.status).toBe(201);
    const body = startRandom.body as {
      questions: Array<{ type: string; options: Array<{ text: string }> }>;
    };
    expect(body.questions).toHaveLength(2);

    // Also verify true_false ordering invariant specifically
    const manualQuizId = await s.createAndPublishQuiz({
      shuffleOptions: true, // option shuffle is turned on
    });
    const startManual = await s.asStudent1("POST", `/quizzes/${manualQuizId}/attempts`);
    expect(startManual.status).toBe(201);
    const manualBody = startManual.body as {
      questions: Array<{ type: string; options: Array<{ text: string }> }>;
    };
    const tfQuestion = manualBody.questions.find((q) => q.type === "true_false");
    expect(tfQuestion).toBeDefined();
    // True must ALWAYS remain first even when shuffleOptions is true
    expect(tfQuestion!.options[0]!.text).toBe("True");
    expect(tfQuestion!.options[1]!.text).toBe("False");
  });

  // Step 8.6: Autosave and Linear Navigation Tests (FR-X04)
  it("autosaves answers in free navigation mode, allows clearing, and rehydrates via GET /attempts/:id/answers", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz({ navigation: "free" });

    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(startRes.status).toBe(201);
    const startBody = startRes.body as {
      id: string;
      questions: Array<{ id: string; options: Array<{ id: string }> }>;
    };
    const attemptId = startBody.id;
    const q1 = startBody.questions[0]!;
    const q2 = startBody.questions[1]!;

    // Save Q1 with first option
    const save1 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1.options[0]!.id],
    });
    expect(save1.status).toBe(200);
    expect((save1.body as { questionId: string }).questionId).toBe(q1.id);
    expect((save1.body as { selectedOptionIds: string[] }).selectedOptionIds).toEqual([
      q1.options[0]!.id,
    ]);

    // Update Q1 with second option
    const save1Update = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1.options[1]!.id],
    });
    expect(save1Update.status).toBe(200);
    expect((save1Update.body as { selectedOptionIds: string[] }).selectedOptionIds).toEqual([
      q1.options[1]!.id,
    ]);

    // Save Q2 with multiple options
    const save2 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q2.id}`, {
      selectedOptionIds: [q2.options[0]!.id, q2.options[1]!.id],
    });
    expect(save2.status).toBe(200);
    expect((save2.body as { selectedOptionIds: string[] }).selectedOptionIds).toHaveLength(2);

    // Rehydrate via GET /attempts/:id/answers
    const listRes = await s.asStudent1("GET", `/attempts/${attemptId}/answers`);
    expect(listRes.status).toBe(200);
    const listBody = listRes.body as {
      answers: Array<{ questionId: string; selectedOptionIds: string[] }>;
    };
    expect(listBody.answers).toHaveLength(2);

    const ans1 = listBody.answers.find((a) => a.questionId === q1.id);
    expect(ans1?.selectedOptionIds).toEqual([q1.options[1]!.id]);

    const ans2 = listBody.answers.find((a) => a.questionId === q2.id);
    expect(ans2?.selectedOptionIds).toHaveLength(2);

    // Clear answer on Q1
    const clear1 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [],
    });
    expect(clear1.status).toBe(200);
    expect((clear1.body as { selectedOptionIds: string[] }).selectedOptionIds).toEqual([]);
  });

  it("enforces option and question validation rules on autosave", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    const startBody = startRes.body as {
      id: string;
      questions: Array<{ id: string; type: string; options: Array<{ id: string }> }>;
    };
    const attemptId = startBody.id;
    const singleQ = startBody.questions.find((q) => q.type === "single")!;
    const foreignUUID = randomUUID();

    // 1. Question not in attempt snapshot
    const foreignQRes = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${foreignUUID}`, {
      selectedOptionIds: [],
    });
    expect(foreignQRes.status).toBe(400);
    expect(reasonOf(foreignQRes.body)).toBe(AttemptReasonCode.QUESTION_NOT_IN_ATTEMPT);

    // 2. Foreign option ID not belonging to question
    const invalidOptRes = await s.asStudent1(
      "PUT",
      `/attempts/${attemptId}/answers/${singleQ.id}`,
      {
        selectedOptionIds: [foreignUUID],
      },
    );
    expect(invalidOptRes.status).toBe(400);
    expect(reasonOf(invalidOptRes.body)).toBe(AttemptReasonCode.INVALID_QUESTION_OPTION);

    // 3. Single choice violation: selecting 2 options on single choice question
    const multiOnSingleRes = await s.asStudent1(
      "PUT",
      `/attempts/${attemptId}/answers/${singleQ.id}`,
      {
        selectedOptionIds: [singleQ.options[0]!.id, singleQ.options[1]!.id],
      },
    );
    expect(multiOnSingleRes.status).toBe(400);
    expect(reasonOf(multiOnSingleRes.body)).toBe(AttemptReasonCode.SINGLE_CHOICE_VIOLATION);

    // 4. Already submitted attempt
    await systemPrisma.attempt.update({
      where: { id: attemptId },
      data: { submittedAt: new Date() },
    });

    const submittedRes = await s.asStudent1(
      "PUT",
      `/attempts/${attemptId}/answers/${singleQ.id}`,
      {
        selectedOptionIds: [singleQ.options[0]!.id],
      },
    );
    expect(submittedRes.status).toBe(400);
    expect(reasonOf(submittedRes.body)).toBe(AttemptReasonCode.ATTEMPT_ALREADY_SUBMITTED);
  });

  it("enforces deadline cutoff with 10-second grace window (ATTEMPT_EXPIRED)", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    const startBody = startRes.body as {
      id: string;
      questions: Array<{ id: string; options: Array<{ id: string }> }>;
    };
    const attemptId = startBody.id;
    const q1 = startBody.questions[0]!;

    // Set deadline to 5 seconds ago (within 10s grace buffer)
    await systemPrisma.attempt.update({
      where: { id: attemptId },
      data: { deadlineAt: new Date(Date.now() - 5000) },
    });

    const graceRes = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1.options[0]!.id],
    });
    expect(graceRes.status).toBe(200);

    // Set deadline to 15 seconds ago (exceeding 10s grace buffer)
    await systemPrisma.attempt.update({
      where: { id: attemptId },
      data: { deadlineAt: new Date(Date.now() - 15000) },
    });

    const expiredRes = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1.options[0]!.id],
    });
    expect(expiredRes.status).toBe(400);
    expect(reasonOf(expiredRes.body)).toBe(AttemptReasonCode.ATTEMPT_EXPIRED);
  });

  it("enforces device lock on PUT and GET answers", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz();

    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    const startBody = startRes.body as {
      id: string;
      questions: Array<{ id: string; options: Array<{ id: string }> }>;
    };
    const attemptId = startBody.id;
    const q1 = startBody.questions[0]!;

    // Student signs out on Device 1 and logs into Device 2
    await systemPrisma.session.deleteMany({ where: { userId: s.studentMember.user.id } });
    const dev2 = await fx.device(s.studentMember.user.id);
    const studentLogin2 = await fx.studentLogin(s.t, s.studentMember.user.email, dev2.cookie);
    expect(studentLogin2.status).toBe(200);

    const asStudent2 = (method: string, path: string, body?: unknown) =>
      http.send(`${s.t.slug}.localhost`, method, `/api${path}`, body, {
        cookie: studentLogin2.cookies,
      });

    // Device 2 cannot save answers on Device 1's active attempt
    const putRes = await asStudent2("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1.options[0]!.id],
    });
    expect(putRes.status).toBe(403);
    expect(reasonOf(putRes.body)).toBe(AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH);

    // Device 2 cannot read answers of Device 1's active attempt
    const getRes = await asStudent2("GET", `/attempts/${attemptId}/answers`);
    expect(getRes.status).toBe(403);
    expect(reasonOf(getRes.body)).toBe(AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH);
  });

  it("strictly enforces linear navigation: sequential progression, current question updates, backtrack & forward skip rejection", async () => {
    const s = await setup();
    const quizId = await s.createAndPublishQuiz({
      navigation: "linear",
    });

    const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
    expect(startRes.status).toBe(201);
    const startBody = startRes.body as {
      id: string;
      questions: Array<{ id: string; options: Array<{ id: string }> }>;
    };
    const attemptId = startBody.id;
    const q0 = startBody.questions[0]!;
    const q1 = startBody.questions[1]!;
    const q2 = startBody.questions[2]!;

    // 1. Trying to jump forward to Q2 out of order (i > M + 1, where M = -1) -> 400 LINEAR_NAVIGATION_SKIP_FORBIDDEN
    const skipQ2Res = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q2.id}`, {
      selectedOptionIds: [q2.options[0]!.id],
    });
    expect(skipQ2Res.status).toBe(400);
    expect(reasonOf(skipQ2Res.body)).toBe(AttemptReasonCode.LINEAR_NAVIGATION_SKIP_FORBIDDEN);

    // 2. Answer Q0 -> 200 OK (frontier advances to 0)
    const ansQ0 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q0.id}`, {
      selectedOptionIds: [q0.options[0]!.id],
    });
    expect(ansQ0.status).toBe(200);

    // 3. Revise Q0 -> 200 OK (i === M, modifying current frontier question is allowed)
    const reviseQ0 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q0.id}`, {
      selectedOptionIds: [q0.options[1]!.id],
    });
    expect(reviseQ0.status).toBe(200);
    expect((reviseQ0.body as { selectedOptionIds: string[] }).selectedOptionIds).toEqual([
      q0.options[1]!.id,
    ]);

    // 4. Try to jump ahead to Q2 (i === 2, but M === 0, so i > M + 1) -> 400 LINEAR_NAVIGATION_SKIP_FORBIDDEN
    const jumpQ2 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q2.id}`, {
      selectedOptionIds: [q2.options[0]!.id],
    });
    expect(jumpQ2.status).toBe(400);
    expect(reasonOf(jumpQ2.body)).toBe(AttemptReasonCode.LINEAR_NAVIGATION_SKIP_FORBIDDEN);

    // 5. Answer Q1 -> 200 OK (i === 1, frontier advances to 1)
    const ansQ1 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1.options[0]!.id],
    });
    expect(ansQ1.status).toBe(200);

    // 6. Try to backtrack to Q0 now that Q1 has been answered (i === 0 < M === 1) -> 400 LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN
    const backtrackQ0 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q0.id}`, {
      selectedOptionIds: [q0.options[0]!.id],
    });
    expect(backtrackQ0.status).toBe(400);
    expect(reasonOf(backtrackQ0.body)).toBe(
      AttemptReasonCode.LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN,
    );

    // 7. Skip Q2 by submitting empty options -> 200 OK (i === 2 === M + 1, frontier advances to 2)
    const skipQ2 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q2.id}`, {
      selectedOptionIds: [],
    });
    expect(skipQ2.status).toBe(200);

    // 8. Try to backtrack to Q1 now that Q2 has been skipped (i === 1 < M === 2) -> 400 LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN
    const backtrackQ1 = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
      selectedOptionIds: [q1.options[0]!.id],
    });
    expect(backtrackQ1.status).toBe(400);
    expect(reasonOf(backtrackQ1.body)).toBe(
      AttemptReasonCode.LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN,
    );
  });

  describe("Step 8.7: Submission, Auto-Submission & Server Grading", () => {
    it("grades single, multiple, and true_false questions with 100% score on submit", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const startBody = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };
      const attemptId = startBody.id;

      const q1 = startBody.questions.find((q) => q.type === "single")!;
      const q2 = startBody.questions.find((q) => q.type === "multiple")!;
      const q3 = startBody.questions.find((q) => q.type === "true_false")!;

      const opt4 = q1.options.find((o) => o.text === "4")!;
      const opt2 = q2.options.find((o) => o.text === "2")!;
      const opt3 = q2.options.find((o) => o.text === "3")!;
      const optTrue = q3.options.find((o) => o.text === "True")!;

      // Answer all correctly (note: reverse order on multiple choice [opt3, opt2])
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [opt4.id],
      });
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q2.id}`, {
        selectedOptionIds: [opt3.id, opt2.id],
      });
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q3.id}`, {
        selectedOptionIds: [optTrue.id],
      });

      // Submit attempt
      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);
      const body = submitRes.body as {
        id: string;
        status: string;
        gradesReleased: boolean;
        score: number;
        maxScore: number;
        percentage: number;
        passed: boolean;
        autoSubmitted: boolean;
      };
      expect(body.status).toBe("submitted");
      expect(body.gradesReleased).toBe(true);
      expect(body.score).toBe(6);
      expect(body.maxScore).toBe(6);
      expect(body.percentage).toBe(100);
      expect(body.passed).toBe(true);
      expect(body.autoSubmitted).toBe(false);

      // Verify DB state
      const answers = await systemPrisma.attemptAnswer.findMany({
        where: { attemptId },
        orderBy: { marksAwarded: "desc" },
      });
      expect(answers).toHaveLength(3);
      expect(answers.every((a) => a.isCorrect === true)).toBe(true);

      const attemptInDb = await systemPrisma.attempt.findUnique({ where: { id: attemptId } });
      expect(attemptInDb?.score).toBe(6);
      expect(attemptInDb?.passed).toBe(true);
      expect(attemptInDb?.submittedAt).not.toBeNull();
    });

    it("grades multiple choice questions with exact set logic (0 marks if partial or extra)", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      // Student 1: Partial multiple choice (selects only 1 of the 2 correct options)
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };

      const q1 = questions.find((q) => q.type === "single")!;
      const q2 = questions.find((q) => q.type === "multiple")!;
      const q3 = questions.find((q) => q.type === "true_false")!;

      const opt4 = q1.options.find((o) => o.text === "4")!;
      const opt2 = q2.options.find((o) => o.text === "2")!;
      const optTrue = q3.options.find((o) => o.text === "True")!;

      // Q1 correct (2), Q2 partial (0), Q3 correct (1) -> score = 3 out of 6 (50%) -> passed: true
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [opt4.id],
      });
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q2.id}`, {
        selectedOptionIds: [opt2.id],
      });
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q3.id}`, {
        selectedOptionIds: [optTrue.id],
      });

      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);
      const body = submitRes.body as { score: number; percentage: number; passed: boolean };
      expect(body.score).toBe(3);
      expect(body.percentage).toBe(50);
      expect(body.passed).toBe(true);

      const q2Answer = await systemPrisma.attemptAnswer.findUnique({
        where: { attemptId_questionId: { attemptId, questionId: q2.id } },
      });
      expect(q2Answer?.isCorrect).toBe(false);
      expect(q2Answer?.marksAwarded).toBe(0);
    });

    it("creates 0-mark records for skipped or unattempted questions upon submit", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };

      const q1 = questions.find((q) => q.type === "single")!;
      const opt4 = q1.options.find((o) => o.text === "4")!;

      // Answer ONLY Q1, leave Q2 and Q3 completely untouched
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [opt4.id],
      });

      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);
      expect((submitRes.body as { score: number }).score).toBe(2);

      // Verify all 3 questions now have records in DB
      const allAnswers = await systemPrisma.attemptAnswer.findMany({ where: { attemptId } });
      expect(allAnswers).toHaveLength(3);

      const unattempted = allAnswers.filter((a) => a.questionId !== q1.id);
      expect(unattempted).toHaveLength(2);
      expect(
        unattempted.every(
          (a) =>
            a.isCorrect === false &&
            a.marksAwarded === 0 &&
            a.selectedOptionIds.length === 0,
        ),
      ).toBe(true);
    });

    it("idempotently returns existing submission on repeated POST /submit and rejects further autosaves", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      // First submit
      const submit1 = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submit1.status).toBe(200);

      // Repeated submit
      const submit2 = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submit2.status).toBe(200);
      expect(submit2.body).toEqual(submit1.body);

      // Verify only 1 audit log was created
      const auditCount = await systemPrisma.auditLog.count({
        where: { action: "attempt.submit", targetId: attemptId },
      });
      expect(auditCount).toBe(1);

      // Trying to autosave now fails with ATTEMPT_ALREADY_SUBMITTED
      const startBody = startRes.body as { questions: Array<{ id: string }> };
      const q0 = startBody.questions[0]!;
      const autosaveRes = await s.asStudent1(
        "PUT",
        `/attempts/${attemptId}/answers/${q0.id}`,
        {
          selectedOptionIds: [],
        },
      );
      expect(autosaveRes.status).toBe(400);
      expect(reasonOf(autosaveRes.body)).toBe(AttemptReasonCode.ATTEMPT_ALREADY_SUBMITTED);
    });

    it("gracefully auto-submits saved answers when submitting after deadline + grace", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };

      const q1 = questions.find((q) => q.type === "single")!;
      const opt4 = q1.options.find((o) => o.text === "4")!;
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [opt4.id],
      });

      // Manually expire the attempt in DB past grace window (deadline was 30s ago)
      const expiredDeadline = new Date(Date.now() - 30_000);
      await systemPrisma.attempt.update({
        where: { id: attemptId },
        data: { deadlineAt: expiredDeadline },
      });

      // Late submit returns 200 OK with autoSubmitted: true and clamped submittedAt
      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);
      const body = submitRes.body as {
        status: string;
        autoSubmitted: boolean;
        score: number;
        submittedAt: string;
      };
      expect(body.status).toBe("submitted");
      expect(body.autoSubmitted).toBe(true);
      expect(body.score).toBe(2);
      expect(body.submittedAt).toBe(expiredDeadline.toISOString());
    });

    it("auto-submits and finalizes attempt on read (GET /attempts/:id and GET /answers) when deadline expired", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      // 1. Test auto-submit on GET /attempts/:id
      const startRes1 = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId1 = (startRes1.body as { id: string }).id;

      // Backdate deadline
      await systemPrisma.attempt.update({
        where: { id: attemptId1 },
        data: { deadlineAt: new Date(Date.now() - 30_000) },
      });

      const getRes1 = await s.asStudent1("GET", `/attempts/${attemptId1}`);
      expect(getRes1.status).toBe(200);
      const body1 = getRes1.body as { status: string; score: number };
      expect(body1.status).toBe("submitted");
      expect(body1.score).toBe(0);

      const dbAttempt1 = await systemPrisma.attempt.findUnique({ where: { id: attemptId1 } });
      expect(dbAttempt1?.submittedAt).not.toBeNull();

      // 2. Test auto-submit on GET /attempts/:id/answers
      const quizId2 = await s.createAndPublishQuiz();
      const startRes2 = await s.asStudent1("POST", `/quizzes/${quizId2}/attempts`);
      const attemptId2 = (startRes2.body as { id: string }).id;

      await systemPrisma.attempt.update({
        where: { id: attemptId2 },
        data: { deadlineAt: new Date(Date.now() - 30_000) },
      });

      const getAnswersRes = await s.asStudent1("GET", `/attempts/${attemptId2}/answers`);
      expect(getAnswersRes.status).toBe(200);

      const dbAttempt2 = await systemPrisma.attempt.findUnique({ where: { id: attemptId2 } });
      expect(dbAttempt2?.submittedAt).not.toBeNull();
    });

    it("masks grades when quiz.gradeRelease is manual or all_submitted (FR-X05, FR-X08)", async () => {
      const s = await setup();
      // Create quiz with gradeRelease: "manual"
      const quizId = await s.createAndPublishQuiz({ gradeRelease: "manual" });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };

      const q1 = questions.find((q) => q.type === "single")!;
      const opt4 = q1.options.find((o) => o.text === "4")!;
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [opt4.id],
      });

      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);
      const body = submitRes.body as {
        status: string;
        gradesReleased: boolean;
        score: number | null;
        maxScore: number | null;
        percentage: number | null;
        passed: boolean | null;
      };
      expect(body.status).toBe("submitted");
      expect(body.gradesReleased).toBe(false);
      expect(body.score).toBeNull();
      expect(body.maxScore).toBeNull();
      expect(body.percentage).toBeNull();
      expect(body.passed).toBeNull();

      // Check DB: score is actually computed and saved!
      const dbAttempt = await systemPrisma.attempt.findUnique({ where: { id: attemptId } });
      expect(dbAttempt?.score).toBe(2);

      // Subsequent GET /attempts/:id also masks grades
      const getRes = await s.asStudent1("GET", `/attempts/${attemptId}`);
      expect(getRes.status).toBe(200);
      const getBody = getRes.body as { gradesReleased: boolean; score: number | null };
      expect(getBody.gradesReleased).toBe(false);
      expect(getBody.score).toBeNull();
    });

    it("releases grades when quiz.gradeRelease is on_close and closesAt has passed", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz({
        gradeRelease: "on_close",
      });

      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };

      const q1 = questions.find((q) => q.type === "single")!;
      const opt4 = q1.options.find((o) => o.text === "4")!;
      await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [opt4.id],
      });

      // Backdate closesAt in database to simulate quiz window closure
      await systemPrisma.quiz.update({
        where: { id: quizId },
        data: { closesAt: new Date(Date.now() - 5_000) },
      });

      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);
      const body = submitRes.body as { gradesReleased: boolean; score: number };
      expect(body.gradesReleased).toBe(true);
      expect(body.score).toBe(2);
    });
  });
});
