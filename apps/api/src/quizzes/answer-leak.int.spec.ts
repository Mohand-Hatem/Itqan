// Step 8.8: Answer-leak test suite (FR-X05, FR-X08, docs/09-security.md §5)
// Guarantees zero leakage of correct answers, explanations, or grading hints
// across all student-accessible endpoints before grade release.

import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, type QuizCreateInput } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("AnswerLeakTestPassword123!");
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

/**
 * Adversarial recursive payload scanner.
 * Traverses any nested structure (arrays, objects) and asserts:
 * 1. No key matches forbidden answer-leak terms (case-insensitive).
 * 2. No string value contains any secret canary strings.
 */
function assertZeroAnswerLeak(payload: unknown, forbiddenCanaries: string[] = []): void {
  const rawJson = JSON.stringify(payload);

  for (const canary of forbiddenCanaries) {
    expect(
      rawJson,
      `Secret canary "${canary}" leaked in student response payload!`,
    ).not.toContain(canary);
  }

  const forbiddenKeys = [
    "iscorrect",
    "explanation",
    "correctoptionid",
    "correctoptionids",
    "answerkey",
    "marksawarded",
  ];

  function traverse(obj: unknown, path: string = ""): void {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => traverse(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      for (const forbidden of forbiddenKeys) {
        expect(
          lowerKey,
          `Forbidden key "${key}" found at path "${path}.${key}" in student payload: ${rawJson}`,
        ).not.toBe(forbidden);
      }
      traverse(value, `${path}.${key}`);
    }
  }

  traverse(payload);
}

async function setup() {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const assistant = await fx.staffLogin(t, "assistant");

  // Enrolled student
  const studentMember = await fx.member(t.id, "student", { maxDevices: 2 });
  const studentLogin = await fx.studentLogin(t, studentMember.user.email);

  const asTeacher = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: teacher.cookie,
    });

  const asStudent = (method: string, path: string, body?: unknown, tenant: Tenant = t) =>
    http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, {
      cookie: studentLogin.cookies,
    });

  // Create course
  const courseRes = await asTeacher("POST", "/courses", { title: "Leak Security Course" });
  const courseId = (courseRes.body as { id: string }).id;

  // Enroll student in course
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

  // Secret canaries embedded in question explanations
  const CANARY_SINGLE = "CANARY_SECRET_EXPLANATION_SINGLE_991823";
  const CANARY_MULTIPLE = "CANARY_SECRET_EXPLANATION_MULTIPLE_849201";
  const CANARY_TF = "CANARY_SECRET_EXPLANATION_TF_381024";
  const allCanaries = [CANARY_SINGLE, CANARY_MULTIPLE, CANARY_TF];

  // Create question bank
  const bankRes = await asTeacher("POST", "/question-banks", {
    title: "Leak Security Question Bank",
    courseId,
  });
  const bankId = (bankRes.body as { id: string }).id;

  // Question 1: single choice
  const q1Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "single",
    text: "Question 1: What is the capital of France?",
    marks: 2,
    difficulty: "easy",
    explanation: CANARY_SINGLE,
    options: [
      { text: "London", isCorrect: false },
      { text: "Paris", isCorrect: true },
      { text: "Berlin", isCorrect: false },
    ],
  });
  const q1Id = (q1Res.body as { id: string }).id;

  // Question 2: multiple choice
  const q2Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "multiple",
    text: "Question 2: Select prime numbers",
    marks: 3,
    difficulty: "medium",
    explanation: CANARY_MULTIPLE,
    options: [
      { text: "2", isCorrect: true },
      { text: "3", isCorrect: true },
      { text: "4", isCorrect: false },
    ],
  });
  const q2Id = (q2Res.body as { id: string }).id;

  // Question 3: true_false
  const q3Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "true_false",
    text: "Question 3: Water boils at 100C at 1 atm.",
    marks: 1,
    difficulty: "easy",
    explanation: CANARY_TF,
    options: [
      { text: "True", isCorrect: true },
      { text: "False", isCorrect: false },
    ],
  });
  const q3Id = (q3Res.body as { id: string }).id;

  const createAndPublishQuiz = async (overrides: Partial<QuizCreateInput> = {}) => {
    const defaultOpens = new Date(Date.now() - 60_000).toISOString();
    const defaultCloses = new Date(Date.now() + 3_600_000).toISOString();

    const payload: QuizCreateInput = {
      courseId,
      title: "Security Quiz",
      description: "Leak test quiz",
      durationMin: 30,
      passMark: 50,
      maxAttempts: 2,
      selection: "manual",
      shuffleQuestions: true,
      shuffleOptions: true,
      navigation: "free",
      gradeRelease: "on_submit",
      reviewMode: "grade",
      opensAt: defaultOpens,
      closesAt: defaultCloses,
      questionIds: [q1Id, q2Id, q3Id],
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
    studentMember,
    courseId,
    bankId,
    q1Id,
    q2Id,
    q3Id,
    allCanaries,
    asTeacher,
    asStudent,
    createAndPublishQuiz,
  };
}

describe("Exam Answer-Leak Test Suite (Step 8.8)", () => {
  describe("RBAC Isolation (Gate G1)", () => {
    it("blocks students from GET /quizzes and GET /quizzes/:id", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const listRes = await s.asStudent("GET", "/quizzes");
      expect(listRes.status).toBe(403);
      expect((listRes.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      const getRes = await s.asStudent("GET", `/quizzes/${quizId}`);
      expect(getRes.status).toBe(403);
      expect((getRes.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    });

    it("blocks students from question-banks and questions endpoints", async () => {
      const s = await setup();

      const banksRes = await s.asStudent("GET", "/question-banks");
      expect(banksRes.status).toBe(403);
      expect((banksRes.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      const bankDetailRes = await s.asStudent("GET", `/question-banks/${s.bankId}`);
      expect(bankDetailRes.status).toBe(403);
      expect((bankDetailRes.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      const bankQuestionsRes = await s.asStudent("GET", `/question-banks/${s.bankId}/questions`);
      expect(bankQuestionsRes.status).toBe(403);
      expect((bankQuestionsRes.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      const questionRes = await s.asStudent("GET", `/questions/${s.q1Id}`);
      expect(questionRes.status).toBe(403);
      expect((questionRes.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    });
  });

  describe("Attempt Start and Resume (Gate G2)", () => {
    it("strips isCorrect, explanation canaries, and correctOptionIds on POST /attempts start", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const startRes = await s.asStudent("POST", `/quizzes/${quizId}/attempts`);
      expect(startRes.status).toBe(201);

      // Adversarial scan: zero forbidden keys, zero secret canary strings
      assertZeroAnswerLeak(startRes.body, s.allCanaries);

      const body = startRes.body as {
        questions: Array<{
          id: string;
          text: string;
          type: string;
          marks: number;
          options: Array<{ id: string; text: string }>;
        }>;
      };

      expect(body.questions).toHaveLength(3);
      for (const q of body.questions) {
        // Assert every question object has only allowed public fields
        expect(q).not.toHaveProperty("isCorrect");
        expect(q).not.toHaveProperty("explanation");
        expect(q).not.toHaveProperty("correctOptionIds");
        expect(q).not.toHaveProperty("marksAwarded");

        for (const opt of q.options) {
          expect(opt).not.toHaveProperty("isCorrect");
          expect(opt).toHaveProperty("id");
          expect(opt).toHaveProperty("text");
        }

        // True/false option order invariant: always True then False, neither marked
        if (q.type === "true_false") {
          expect(q.options).toHaveLength(2);
          expect(q.options[0].text).toBe("True");
          expect(q.options[1].text).toBe("False");
        }
      }
    });

    it("strips all answer keys and masks unreleased grades on GET /attempts/:id resume", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz({ gradeRelease: "manual" });

      const startRes = await s.asStudent("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      const getRes = await s.asStudent("GET", `/attempts/${attemptId}`);
      expect(getRes.status).toBe(200);

      assertZeroAnswerLeak(getRes.body, s.allCanaries);

      const body = getRes.body as {
        gradesReleased: boolean;
        score: number | null;
        percentage: number | null;
        passed: boolean | null;
      };

      expect(body.gradesReleased).toBe(false);
      expect(body.score).toBeNull();
      expect(body.percentage).toBeNull();
      expect(body.passed).toBeNull();
    });
  });

  describe("Autosave and Answers Retrieval (Gate G3)", () => {
    it("returns zero grading feedback, correctness flags, or marks on PUT /answers", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const startRes = await s.asStudent("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };

      const q1 = questions.find((q) => q.type === "single")!;
      const correctOption = q1.options.find((o) => o.text === "Paris")!;

      // Student autosaves the CORRECT option
      const putCorrectRes = await s.asStudent("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [correctOption.id],
      });
      expect(putCorrectRes.status).toBe(200);

      // Must NOT leak whether it is correct or how many marks it got!
      assertZeroAnswerLeak(putCorrectRes.body, s.allCanaries);
      expect(putCorrectRes.body).toEqual({
        questionId: q1.id,
        selectedOptionIds: [correctOption.id],
        savedAt: expect.any(String),
      });

      // Student changes to an INCORRECT option
      const wrongOption = q1.options.find((o) => o.text === "London")!;
      const putWrongRes = await s.asStudent("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [wrongOption.id],
      });
      expect(putWrongRes.status).toBe(200);

      assertZeroAnswerLeak(putWrongRes.body, s.allCanaries);
      expect(putWrongRes.body).toEqual({
        questionId: q1.id,
        selectedOptionIds: [wrongOption.id],
        savedAt: expect.any(String),
      });
    });

    it("returns zero correctness or marks awarded on GET /attempts/:id/answers", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      const startRes = await s.asStudent("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; options: Array<{ id: string }> }>;
      };

      const q1 = questions[0];
      await s.asStudent("PUT", `/attempts/${attemptId}/answers/${q1.id}`, {
        selectedOptionIds: [q1.options[0].id],
      });

      const answersRes = await s.asStudent("GET", `/attempts/${attemptId}/answers`);
      expect(answersRes.status).toBe(200);

      assertZeroAnswerLeak(answersRes.body, s.allCanaries);
      const answersBody = answersRes.body as {
        answers: Array<{ questionId: string; selectedOptionIds: string[]; savedAt: string }>;
      };

      expect(answersBody.answers).toHaveLength(1);
      expect(answersBody.answers[0]).not.toHaveProperty("isCorrect");
      expect(answersBody.answers[0]).not.toHaveProperty("marksAwarded");
    });
  });

  describe("Submission and Grade Masking (Gate G4)", () => {
    it("masks score and leaks zero answer keys on POST /submit when grades are not released", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz({ gradeRelease: "manual" });

      const startRes = await s.asStudent("POST", `/quizzes/${quizId}/attempts`);
      const { id: attemptId, questions } = startRes.body as {
        id: string;
        questions: Array<{ id: string; type: string; options: Array<{ id: string; text: string }> }>;
      };

      // Answer all correctly
      for (const q of questions) {
        if (q.type === "single") {
          const opt = q.options.find((o) => o.text === "Paris")!;
          await s.asStudent("PUT", `/attempts/${attemptId}/answers/${q.id}`, {
            selectedOptionIds: [opt.id],
          });
        } else if (q.type === "multiple") {
          const opts = q.options.filter((o) => o.text === "2" || o.text === "3");
          await s.asStudent("PUT", `/attempts/${attemptId}/answers/${q.id}`, {
            selectedOptionIds: opts.map((o) => o.id),
          });
        } else if (q.type === "true_false") {
          const opt = q.options.find((o) => o.text === "True")!;
          await s.asStudent("PUT", `/attempts/${attemptId}/answers/${q.id}`, {
            selectedOptionIds: [opt.id],
          });
        }
      }

      const submitRes = await s.asStudent("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);

      assertZeroAnswerLeak(submitRes.body, s.allCanaries);

      const body = submitRes.body as {
        gradesReleased: boolean;
        score: number | null;
        maxScore: number | null;
        percentage: number | null;
        passed: boolean | null;
      };

      expect(body.gradesReleased).toBe(false);
      expect(body.score).toBeNull();
      expect(body.maxScore).toBeNull();
      expect(body.percentage).toBeNull();
      expect(body.passed).toBeNull();
      expect(submitRes.body).not.toHaveProperty("questions");
      expect(submitRes.body).not.toHaveProperty("answers");
    });

    it("returns top-level scores on POST /submit when gradeRelease is on_submit without leaking question answers or explanations", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz({ gradeRelease: "on_submit" });

      const startRes = await s.asStudent("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      const submitRes = await s.asStudent("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);

      // Even when score is released, no question-level answer keys or explanations are leaked
      assertZeroAnswerLeak(submitRes.body, s.allCanaries);

      const body = submitRes.body as {
        gradesReleased: boolean;
        score: number;
        maxScore: number;
        percentage: number;
        passed: boolean;
      };

      expect(body.gradesReleased).toBe(true);
      expect(body.score).toBe(0); // 0 because none answered
      expect(body.maxScore).toBe(6);
      expect(body.percentage).toBe(0);
      expect(body.passed).toBe(false);
      expect(submitRes.body).not.toHaveProperty("questions");
      expect(submitRes.body).not.toHaveProperty("answers");
    });
  });

  describe("Curriculum and Content Access (Gate G5)", () => {
    it("shows only item metadata in GET /courses/:id/tree and returns 404 on quiz content access", async () => {
      const s = await setup();
      const quizId = await s.createAndPublishQuiz();

      // Create content item of kind 'quiz' referencing quizId
      const itemRes = await s.asTeacher("POST", "/content-items", {
        courseId: s.courseId,
        kind: "quiz",
        title: "Midterm Exam Item",
        quizId,
      });
      expect(itemRes.status).toBe(201);
      const itemId = (itemRes.body as { id: string }).id;

      // Publish content item
      await s.asTeacher("PATCH", `/content-items/${itemId}`, {
        published: true,
      });

      // Ensure course is published so student can view tree
      await systemPrisma.course.update({
        where: { id: s.courseId },
        data: { status: "published" },
      });

      // Student fetches curriculum tree
      const treeRes = await s.asStudent("GET", `/courses/${s.courseId}/tree`);
      expect(treeRes.status).toBe(200);

      assertZeroAnswerLeak(treeRes.body, s.allCanaries);

      const tree = treeRes.body as Array<{ id: string; kind: string; title: string }>;
      const quizItem = tree.find((it) => it.id === itemId);
      expect(quizItem).toBeDefined();
      expect(quizItem?.kind).toBe("quiz");
      expect(quizItem).not.toHaveProperty("quizId");
      expect(quizItem).not.toHaveProperty("questions");
      expect(quizItem).not.toHaveProperty("options");

      // Student attempts to call /content-items/:id/access for the quiz item
      const accessRes = await s.asStudent("GET", `/content-items/${itemId}/access`);
      expect(accessRes.status).toBe(404);
    });
  });
});
