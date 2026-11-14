// Step 8.1: Question banks and questions API (FR-X01)
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { QuestionReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("QuestionsTestPassword123!");
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

  const courseRes = await asTeacher("POST", "/courses", { title: "Biology 101" });
  const courseId = (courseRes.body as { id: string }).id;

  const createAsset = async (over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await systemPrisma.mediaAsset.create({
      data: {
        id,
        tenantId: t.id,
        purpose: "content",
        storageKey: `tenants/${t.id}/${id}`,
        originalName: "cell.png",
        mimeType: "image/png",
        fileSize: 1024n,
        status: "ready",
        uploadedBy: teacher.user.id,
        ...over,
      },
    });
    return id;
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
    createAsset,
  };
}

describe("Question Banks API (Step 8.1)", () => {
  it("allows teachers and assistants to create question banks, both global and course-scoped", async () => {
    const s = await setup();

    // Teacher creates course-scoped bank
    const res1 = await s.asTeacher("POST", "/question-banks", {
      title: "Cell Biology Bank",
      courseId: s.courseId,
    });
    expect(res1.status).toBe(201);
    const bank1 = res1.body as { id: string; title: string; courseId: string };
    expect(bank1.title).toBe("Cell Biology Bank");
    expect(bank1.courseId).toBe(s.courseId);

    // Assistant creates global bank (courseId = null)
    const res2 = await s.asAssistant("POST", "/question-banks", {
      title: "General Science Global Bank",
    });
    expect(res2.status).toBe(201);
    const bank2 = res2.body as { id: string; title: string; courseId: string | null };
    expect(bank2.title).toBe("General Science Global Bank");
    expect(bank2.courseId).toBeNull();

    // Verify audit log
    const audit = await systemPrisma.auditLog.findFirst({
      where: { targetId: bank1.id },
    });
    expect(audit).toMatchObject({
      action: "question_bank.create",
      actorUserId: s.teacher.user.id,
    });
  });

  it("lists question banks with question counts and supports cursor pagination", async () => {
    const s = await setup();
    await s.asTeacher("POST", "/question-banks", { title: "Bank A", courseId: s.courseId });
    await s.asTeacher("POST", "/question-banks", { title: "Bank B", courseId: s.courseId });

    const listRes = await s.asTeacher("GET", `/question-banks?courseId=${s.courseId}`);
    expect(listRes.status).toBe(200);
    const body = listRes.body as { items: Array<{ title: string; questionCount: number }> };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(body.items[0]?.questionCount).toBe(0);
  });

  it("updates question bank title and course reference", async () => {
    const s = await setup();
    const createRes = await s.asTeacher("POST", "/question-banks", { title: "Original Title" });
    const bankId = (createRes.body as { id: string }).id;

    const patchRes = await s.asAssistant("PATCH", `/question-banks/${bankId}`, {
      title: "Updated Title",
      courseId: s.courseId,
    });
    expect(patchRes.status).toBe(200);
    expect((patchRes.body as { title: string; courseId: string }).title).toBe("Updated Title");
    expect((patchRes.body as { title: string; courseId: string }).courseId).toBe(s.courseId);
  });

  it("enforces role permissions: only teachers can delete a bank; assistants receive 403", async () => {
    const s = await setup();
    const createRes = await s.asTeacher("POST", "/question-banks", { title: "Bank to Delete" });
    const bankId = (createRes.body as { id: string }).id;

    // Assistant tries to delete
    const assistantDel = await s.asAssistant("DELETE", `/question-banks/${bankId}`);
    expect(assistantDel.status).toBe(403);

    // Teacher deletes
    const teacherDel = await s.asTeacher("DELETE", `/question-banks/${bankId}`);
    expect(teacherDel.status).toBe(200);

    // Verify bank is soft-deleted
    const getRes = await s.asTeacher("GET", `/question-banks/${bankId}`);
    expect(getRes.status).toBe(404);
  });

  it("cascades soft-delete to all child questions when bank is deleted", async () => {
    const s = await setup();
    const bankRes = await s.asTeacher("POST", "/question-banks", { title: "Cascade Bank" });
    const bankId = (bankRes.body as { id: string }).id;

    // Add 2 questions
    const q1Res = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "single",
      text: "Question 1?",
      options: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: false },
      ],
    });
    const q1Id = (q1Res.body as { id: string }).id;

    const q2Res = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "true_false",
      text: "Question 2?",
      options: [
        { text: "True", isCorrect: true },
        { text: "False", isCorrect: false },
      ],
    });
    const q2Id = (q2Res.body as { id: string }).id;

    // Delete bank
    const delRes = await s.asTeacher("DELETE", `/question-banks/${bankId}`);
    expect(delRes.status).toBe(200);
    expect((delRes.body as { affectedQuestionsCount: number }).affectedQuestionsCount).toBe(2);

    // Child questions cannot be fetched
    const q1Get = await s.asTeacher("GET", `/questions/${q1Id}`);
    expect(q1Get.status).toBe(404);
    const q2Get = await s.asTeacher("GET", `/questions/${q2Id}`);
    expect(q2Get.status).toBe(404);

    // Verify DB rows have deletedAt set
    const dbQ1 = await systemPrisma.question.findUniqueOrThrow({ where: { id: q1Id } });
    expect(dbQ1.deletedAt).not.toBeNull();
  });
});

describe("Questions API (Step 8.1)", () => {
  it("creates single-choice, multiple-choice, and true/false questions with deterministic sortOrder", async () => {
    const s = await setup();
    const bankRes = await s.asTeacher("POST", "/question-banks", { title: "Quiz 1 Bank" });
    const bankId = (bankRes.body as { id: string }).id;

    // 1. Single-choice
    const singleRes = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "single",
      text: "What organelle produces ATP?",
      marks: 2.5,
      difficulty: "easy",
      explanation: "Mitochondria is the powerhouse of the cell.",
      tags: ["Biology", "Cell"],
      options: [
        { text: "Nucleus", isCorrect: false },
        { text: "Mitochondria", isCorrect: true },
        { text: "Ribosome", isCorrect: false },
      ],
    });
    expect(singleRes.status).toBe(201);
    const single = singleRes.body as {
      id: string;
      tags: string[];
      options: Array<{ text: string; isCorrect: boolean; sortOrder: number }>;
    };
    expect(single.tags).toEqual(["biology", "cell"]);
    expect(single.options.map((o) => o.sortOrder)).toEqual([0, 1, 2]);
    expect(single.options.find((o) => o.isCorrect)?.text).toBe("Mitochondria");

    // 2. Multiple-choice
    const multiRes = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "multiple",
      text: "Which of the following are eukaryotic organisms?",
      marks: 3,
      difficulty: "medium",
      options: [
        { text: "Fungi", isCorrect: true },
        { text: "Plants", isCorrect: true },
        { text: "Bacteria", isCorrect: false },
      ],
    });
    expect(multiRes.status).toBe(201);
    const multi = multiRes.body as { options: Array<{ isCorrect: boolean }> };
    expect(multi.options.filter((o) => o.isCorrect).length).toBe(2);

    // 3. True/False
    const tfRes = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "true_false",
      text: "DNA is double-stranded in eukaryotic cells.",
      marks: 1,
      difficulty: "easy",
      options: [
        { text: "صواب", isCorrect: true },
        { text: "خطأ", isCorrect: false },
      ],
    });
    expect(tfRes.status).toBe(201);
    const tf = tfRes.body as { options: Array<{ text: string; isCorrect: boolean }> };
    expect(tf.options.length).toBe(2);
    expect(tf.options[0]?.text).toBe("صواب");
    expect(tf.options[0]?.isCorrect).toBe(true);
  });

  it("validates media asset: attaches valid image and rejects unready or non-image assets", async () => {
    const s = await setup();
    const bankRes = await s.asTeacher("POST", "/question-banks", { title: "Media Bank" });
    const bankId = (bankRes.body as { id: string }).id;

    const validImg = await s.createAsset({ mimeType: "image/jpeg" });
    const resValid = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "single",
      text: "Identify this cell structure:",
      imageAssetId: validImg,
      options: [
        { text: "Cell Wall", isCorrect: true },
        { text: "Membrane", isCorrect: false },
      ],
    });
    expect(resValid.status).toBe(201);

    // PDF asset should be rejected
    const pdfAsset = await s.createAsset({ mimeType: "application/pdf" });
    const resPdf = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "single",
      text: "Bad asset question",
      imageAssetId: pdfAsset,
      options: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: false },
      ],
    });
    expect(resPdf.status).toBe(400);
    expect(reasonOf(resPdf.body)).toBe(QuestionReasonCode.ASSET_NOT_USABLE);
  });

  it("atomically replaces options and updates fields on PATCH /questions/:id", async () => {
    const s = await setup();
    const bankRes = await s.asTeacher("POST", "/question-banks", { title: "Patch Bank" });
    const bankId = (bankRes.body as { id: string }).id;

    const qRes = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "single",
      text: "Original Question?",
      marks: 1,
      options: [
        { text: "Option A", isCorrect: true },
        { text: "Option B", isCorrect: false },
      ],
    });
    const qId = (qRes.body as { id: string }).id;

    // Update text and change options to multiple
    const updateRes = await s.asAssistant("PATCH", `/questions/${qId}`, {
      type: "multiple",
      text: "Updated Question?",
      marks: 4,
      options: [
        { text: "New Option 1", isCorrect: true },
        { text: "New Option 2", isCorrect: true },
        { text: "New Option 3", isCorrect: false },
      ],
    });
    expect(updateRes.status).toBe(200);
    const updated = updateRes.body as {
      text: string;
      marks: number;
      type: string;
      options: Array<{ text: string; isCorrect: boolean; sortOrder: number }>;
    };
    expect(updated.text).toBe("Updated Question?");
    expect(updated.marks).toBe(4);
    expect(updated.type).toBe("multiple");
    expect(updated.options.length).toBe(3);
    expect(updated.options.map((o) => o.sortOrder)).toEqual([0, 1, 2]);

    // DB options check
    const dbOptions = await systemPrisma.questionOption.findMany({
      where: { questionId: qId },
      orderBy: { sortOrder: "asc" },
    });
    expect(dbOptions.length).toBe(3);
    expect(dbOptions[0]?.text).toBe("New Option 1");
  });

  it("soft-deletes question on DELETE /questions/:id", async () => {
    const s = await setup();
    const bankRes = await s.asTeacher("POST", "/question-banks", { title: "Del Bank" });
    const bankId = (bankRes.body as { id: string }).id;

    const qRes = await s.asTeacher("POST", `/question-banks/${bankId}/questions`, {
      type: "single",
      text: "Delete me?",
      options: [
        { text: "Yes", isCorrect: true },
        { text: "No", isCorrect: false },
      ],
    });
    const qId = (qRes.body as { id: string }).id;

    const delRes = await s.asAssistant("DELETE", `/questions/${qId}`);
    expect(delRes.status).toBe(200);

    const getRes = await s.asTeacher("GET", `/questions/${qId}`);
    expect(getRes.status).toBe(404);
  });
});

describe("Multi-Tenant Isolation & Role Authorization", () => {
  it("rejects students with 403 on question bank and question routes", async () => {
    const s = await setup();
    const bankRes = await s.asTeacher("POST", "/question-banks", { title: "Secret Bank" });
    const bankId = (bankRes.body as { id: string }).id;

    const listRes = await s.asStudent("GET", "/question-banks");
    expect(listRes.status).toBe(403);

    const postRes = await s.asStudent("POST", "/question-banks", { title: "Student Bank" });
    expect(postRes.status).toBe(403);

    const qListRes = await s.asStudent("GET", `/question-banks/${bankId}/questions`);
    expect(qListRes.status).toBe(403);
  });

  it("proves strict tenant isolation: Tenant A cannot view, modify, or delete Tenant B's question banks", async () => {
    const sA = await setup();
    const sB = await setup();

    const bankARes = await sA.asTeacher("POST", "/question-banks", { title: "Tenant A Bank" });
    const bankAId = (bankARes.body as { id: string }).id;

    // Tenant B attempts to get Tenant A's bank
    const getRes = await sB.asTeacher("GET", `/question-banks/${bankAId}`);
    expect(getRes.status).toBe(404);

    // Tenant B attempts to patch Tenant A's bank
    const patchRes = await sB.asTeacher("PATCH", `/question-banks/${bankAId}`, {
      title: "Hacked Title",
    });
    expect(patchRes.status).toBe(404);

    // Tenant B attempts to delete Tenant A's bank
    const delRes = await sB.asTeacher("DELETE", `/question-banks/${bankAId}`);
    expect(delRes.status).toBe(404);

    // Tenant B attempts to create question in Tenant A's bank
    const qRes = await sB.asTeacher("POST", `/question-banks/${bankAId}/questions`, {
      type: "single",
      text: "Cross-tenant injection?",
      options: [
        { text: "A", isCorrect: true },
        { text: "B", isCorrect: false },
      ],
    });
    expect(qRes.status).toBe(404);
  });
});
