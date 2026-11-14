// Step 8.3: Quizzes API integration tests (FR-X02, FR-X03)
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { QuizReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("QuizzesTestPassword123!");
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
  const studentMember = await fx.member(t.id, "student");
  const studentLogin = await fx.studentLogin(t, studentMember.user.email);

  const asTeacher = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: teacher.cookie,
    });

  const asAssistant = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: assistant.cookie,
    });

  const asStudent = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: studentLogin.cookies,
    });

  // Course 1
  const courseRes = await asTeacher("POST", "/courses", { title: "Biology 101" });
  const courseId = (courseRes.body as { id: string }).id;

  // Question bank in Course 1
  const bankRes = await asTeacher("POST", "/question-banks", {
    title: "Bio Bank 1",
    courseId,
  });
  const bankId = (bankRes.body as { id: string }).id;

  // Folder item in Course 1 for target
  const folderRes = await asTeacher("POST", "/content-items", {
    courseId,
    kind: "folder",
    title: "Chapter 1",
  });
  const folderId = (folderRes.body as { id: string }).id;

  // Helper to add questions to bank
  const createQuestion = async (text: string, bId = bankId) => {
    const qRes = await asTeacher("POST", `/question-banks/${bId}/questions`, {
      type: "single",
      text,
      marks: 2,
      difficulty: "medium",
      options: [
        { text: "Option A", isCorrect: true },
        { text: "Option B", isCorrect: false },
      ],
    });
    return (qRes.body as { id: string }).id;
  };

  return {
    t,
    teacher,
    assistant,
    student: studentMember,
    asTeacher,
    asAssistant,
    asStudent,
    courseId,
    bankId,
    folderId,
    createQuestion,
  };
}

describe("Quizzes API (Step 8.3)", () => {
  it("allows teachers to create and fetch manual quizzes with valid timing and targets", async () => {
    const s = await setup();
    const q1 = await s.createQuestion("Question 1");
    const q2 = await s.createQuestion("Question 2");

    const opensAt = new Date(Date.now() + 3600_000).toISOString();
    const closesAt = new Date(Date.now() + 7200_000).toISOString(); // 60 min window

    const res = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Midterm Biology",
      description: "Covers Chapter 1",
      durationMin: 30, // 30 min < 60 min window
      passMark: 60,
      maxAttempts: 2,
      selection: "manual",
      questionIds: [q1, q2],
      targetContentItemIds: [s.folderId],
      opensAt,
      closesAt,
    });

    expect(res.status).toBe(201);
    const quiz = res.body as {
      id: string;
      title: string;
      questions: { questionId: string; sortOrder: number }[];
      targets: { contentItemId: string }[];
    };
    expect(quiz.title).toBe("Midterm Biology");
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.questions[0]?.questionId).toBe(q1);
    expect(quiz.questions[0]?.sortOrder).toBe(0);
    expect(quiz.questions[1]?.questionId).toBe(q2);
    expect(quiz.questions[1]?.sortOrder).toBe(1);
    expect(quiz.targets).toHaveLength(1);
    expect(quiz.targets[0]?.contentItemId).toBe(s.folderId);

    // Fetch quiz by ID
    const getRes = await s.asAssistant("GET", `/quizzes/${quiz.id}`);
    expect(getRes.status).toBe(200);
    expect((getRes.body as { id: string }).id).toBe(quiz.id);
  });

  it("rejects timing window smaller than durationMin", async () => {
    const s = await setup();
    const opensAt = new Date(Date.now() + 3600_000).toISOString();
    const closesAt = new Date(Date.now() + 3600_000 + 15 * 60_000).toISOString(); // 15 min window

    const res = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Invalid Timing Quiz",
      durationMin: 30, // 30 min > 15 min window
      passMark: 50,
      opensAt,
      closesAt,
    });

    expect(res.status).toBe(400);
    expect(reasonOf(res.body)).toBe(QuizReasonCode.INVALID_TIMING_WINDOW);
  });

  it("validates random selection bank question counts strictly", async () => {
    const s = await setup();
    // Bank initially has 0 questions
    const opensAt = new Date(Date.now() + 3600_000).toISOString();

    // Attempt random quiz asking for 5 questions from empty bank
    const resFail = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Random Quiz",
      durationMin: 45,
      passMark: 50,
      selection: "random",
      randomCount: 5,
      randomBankIds: [s.bankId],
      opensAt,
    });

    expect(resFail.status).toBe(400);
    expect(reasonOf(resFail.body)).toBe(QuizReasonCode.INSUFFICIENT_BANK_QUESTIONS);

    // Add 2 questions
    await s.createQuestion("Random Q1");
    await s.createQuestion("Random Q2");

    // Create random quiz asking for 2 questions
    const resSuccess = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Random Quiz Ready",
      durationMin: 45,
      passMark: 50,
      selection: "random",
      randomCount: 2,
      randomBankIds: [s.bankId],
      opensAt,
    });

    expect(resSuccess.status).toBe(201);
    expect((resSuccess.body as { randomCount: number }).randomCount).toBe(2);
  });

  it("rejects targets or questions from a different course", async () => {
    const s = await setup();
    // Course 2
    const course2Res = await s.asTeacher("POST", "/courses", { title: "Chemistry 101" });
    const course2Id = (course2Res.body as { id: string }).id;
    const folder2Res = await s.asTeacher("POST", "/content-items", {
      courseId: course2Id,
      kind: "folder",
      title: "Chem Chapter 1",
    });
    const folder2Id = (folder2Res.body as { id: string }).id;

    const opensAt = new Date(Date.now() + 3600_000).toISOString();

    const res = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Cross Course Target Quiz",
      durationMin: 30,
      passMark: 50,
      targetContentItemIds: [folder2Id],
      opensAt,
    });

    expect(res.status).toBe(400);
    expect(reasonOf(res.body)).toBe(QuizReasonCode.TARGET_COURSE_MISMATCH);
  });

  it("enforces publishing checks and mutation lockout on published quizzes", async () => {
    const s = await setup();
    const opensAt = new Date(Date.now() + 3600_000).toISOString();

    // 1. Create empty manual quiz draft
    const draftRes = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Draft Quiz",
      durationMin: 30,
      passMark: 50,
      selection: "manual",
      opensAt,
    });
    expect(draftRes.status).toBe(201);
    const quizId = (draftRes.body as { id: string }).id;

    // 2. Publishing empty manual quiz fails
    const pubFailRes = await s.asTeacher("POST", `/quizzes/${quizId}/publish`);
    expect(pubFailRes.status).toBe(400);

    // 3. Add question to draft quiz
    const q1 = await s.createQuestion("Exam Question 1");
    const updateRes = await s.asTeacher("PATCH", `/quizzes/${quizId}`, {
      questionIds: [q1],
    });
    expect(updateRes.status).toBe(200);

    // 4. Publishing succeeds
    const pubSuccessRes = await s.asTeacher("POST", `/quizzes/${quizId}/publish`);
    expect(pubSuccessRes.status).toBe(200);
    expect((pubSuccessRes.body as { publishedAt: string | null }).publishedAt).not.toBeNull();

    // 5. Trying to publish again gives 409
    const repubRes = await s.asTeacher("POST", `/quizzes/${quizId}/publish`);
    expect(repubRes.status).toBe(409);
    expect(reasonOf(repubRes.body)).toBe(QuizReasonCode.QUIZ_ALREADY_PUBLISHED);

    // 6. Mutating structural settings on published quiz is locked
    const lockedRes = await s.asTeacher("PATCH", `/quizzes/${quizId}`, {
      title: "New Title",
    });
    expect(lockedRes.status).toBe(400);
    expect(reasonOf(lockedRes.body)).toBe(QuizReasonCode.QUIZ_MUTATION_LOCKED);

    // 7. Updating timing fields on published quiz is allowed
    const newClosesAt = new Date(Date.now() + 86400_000).toISOString();
    const timingUpdateRes = await s.asTeacher("PATCH", `/quizzes/${quizId}`, {
      closesAt: newClosesAt,
    });
    expect(timingUpdateRes.status).toBe(200);
    expect((timingUpdateRes.body as { closesAt: string }).closesAt).toBe(newClosesAt);

    // 8. Unpublish quiz
    const unpubRes = await s.asTeacher("POST", `/quizzes/${quizId}/unpublish`);
    expect(unpubRes.status).toBe(200);
    expect((unpubRes.body as { publishedAt: string | null }).publishedAt).toBeNull();

    // 9. Now structural edit works again
    const unlockRes = await s.asTeacher("PATCH", `/quizzes/${quizId}`, {
      title: "Updated After Unpublish",
    });
    expect(unlockRes.status).toBe(200);
    expect((unlockRes.body as { title: string }).title).toBe("Updated After Unpublish");
  });

  it("integrates with curriculum tree (ContentItem kind: 'quiz')", async () => {
    const s = await setup();
    const opensAt = new Date(Date.now() + 3600_000).toISOString();

    const quizRes = await s.asTeacher("POST", "/quizzes", {
      courseId: s.courseId,
      title: "Chapter 1 Quiz",
      durationMin: 20,
      passMark: 50,
      opensAt,
    });
    const quizId = (quizRes.body as { id: string }).id;

    // Create content item of kind 'quiz' referencing quizId
    const itemRes = await s.asTeacher("POST", "/content-items", {
      courseId: s.courseId,
      kind: "quiz",
      title: "Take Chapter 1 Quiz",
      quizId,
    });
    expect(itemRes.status).toBe(201);
    const item = itemRes.body as { id: string; kind: string; quizId: string };
    expect(item.kind).toBe("quiz");
    expect(item.quizId).toBe(quizId);
  });

  it("enforces RBAC and multi-tenant isolation", async () => {
    const s1 = await setup();
    const s2 = await setup();

    const opensAt = new Date(Date.now() + 3600_000).toISOString();
    const qRes = await s1.asTeacher("POST", "/quizzes", {
      courseId: s1.courseId,
      title: "Tenant 1 Quiz",
      durationMin: 30,
      passMark: 50,
      opensAt,
    });
    const quizId = (qRes.body as { id: string }).id;

    // Student cannot access staff quiz management
    const studentRes = await s1.asStudent("POST", "/quizzes", {
      courseId: s1.courseId,
      title: "Student Quiz",
      durationMin: 30,
      passMark: 50,
      opensAt,
    });
    expect(studentRes.status).toBe(403);

    // Tenant 2 teacher cannot see Tenant 1 quiz
    const crossTenantGet = await s2.asTeacher("GET", `/quizzes/${quizId}`);
    expect(crossTenantGet.status).toBe(404);

    // Teacher soft-deletes quiz
    const delRes = await s1.asTeacher("DELETE", `/quizzes/${quizId}`);
    expect(delRes.status).toBe(200);

    // Subsequent GET returns 404
    const getDeleted = await s1.asTeacher("GET", `/quizzes/${quizId}`);
    expect(getDeleted.status).toBe(404);
  });
});
