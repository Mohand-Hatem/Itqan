import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { TENANT_MODELS } from "../tenant-extension.js";

type MakeRow = (db: PrismaClient, tenantId: string) => Promise<{ id: string }>;

// One "make a row" function per tenant-owned model. Adding a tenant table means adding
// an entry here; isolation.int.spec.ts fails until you do, then sweeps the new table.
export const TENANT_FIXTURES: Record<string, MakeRow> = {
  Membership: async (db, tenantId) => {
    const user = await db.user.create({
      data: {
        email: `fixture-${randomUUID()}@example.com`,
        name: "Fixture Student",
      },
    });
    return db.membership.create({ data: { tenantId, userId: user.id, role: "student" } });
  },
  AuditLog: (db, tenantId) => db.auditLog.create({ data: { tenantId, action: "test.fixture" } }),
  SupportRequest: async (db, tenantId) => {
    const user = await db.user.create({
      data: { email: `fixture-${randomUUID()}@example.com`, name: "Fixture Requester" },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, role: "student" },
    });
    return db.supportRequest.create({
      data: { tenantId, membershipId: membership.id, type: "general" },
    });
  },
  Course: (db, tenantId) =>
    db.course.create({
      data: {
        tenantId,
        title: "Fixture Course",
        description: "Fixture Description",
      },
    }),
  Invitation: async (db, tenantId) => {
    const creator = await db.user.create({
      data: { email: `fixture-creator-${randomUUID()}@example.com`, name: "Fixture Creator" },
    });
    return db.invitation.create({
      data: {
        tenantId,
        email: `invited-${randomUUID()}@example.com`,
        tokenHash: randomUUID(),
        courseIds: [],
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        createdBy: creator.id,
      },
    });
  },
  Enrollment: async (db, tenantId) => {
    const user = await db.user.create({
      data: { email: `fixture-enrolled-${randomUUID()}@example.com`, name: "Fixture Enrolled" },
    });
    const granter = await db.user.create({
      data: { email: `fixture-granter-${randomUUID()}@example.com`, name: "Fixture Granter" },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, role: "student" },
    });
    const course = await db.course.create({
      data: { tenantId, title: "Fixture Enrollment Course" },
    });
    return db.enrollment.create({
      data: {
        tenantId,
        membershipId: membership.id,
        courseId: course.id,
        status: "active",
        source: "invitation",
        grantedBy: granter.id,
      },
    });
  },
  AccessCodeBatch: async (db, tenantId) => {
    const creator = await db.user.create({
      data: { email: `fixture-batch-creator-${randomUUID()}@example.com`, name: "Batch Creator" },
    });
    const course = await db.course.create({
      data: { tenantId, title: "Fixture Batch Course" },
    });
    return db.accessCodeBatch.create({
      data: {
        tenantId,
        courseId: course.id,
        name: "Fixture Batch",
        codeCount: 10,
        createdById: creator.id,
      },
    });
  },
  AccessCode: async (db, tenantId) => {
    const creator = await db.user.create({
      data: { email: `fixture-code-creator-${randomUUID()}@example.com`, name: "Code Creator" },
    });
    const course = await db.course.create({
      data: { tenantId, title: "Fixture Code Course" },
    });
    const batch = await db.accessCodeBatch.create({
      data: {
        tenantId,
        courseId: course.id,
        name: "Parent Batch",
        codeCount: 1,
        createdById: creator.id,
      },
    });
    return db.accessCode.create({
      data: {
        tenantId,
        batchId: batch.id,
        courseId: course.id,
        serialNumber: 1,
        codeHash: randomUUID(),
        codePrefix: "TEST",
      },
    });
  },
  MediaAsset: async (db, tenantId) => {
    const uploader = await db.user.create({
      data: { email: `fixture-uploader-${randomUUID()}@example.com`, name: "Fixture Uploader" },
    });
    const id = randomUUID();
    return db.mediaAsset.create({
      data: {
        id,
        tenantId,
        purpose: "content",
        storageKey: `tenants/${tenantId}/${id}`,
        originalName: "fixture.pdf",
        mimeType: "application/pdf",
        fileSize: 1024n,
        uploadedBy: uploader.id,
      },
    });
  },
  ContentItem: async (db, tenantId) => {
    const course = await db.course.create({ data: { tenantId, title: "Fixture Tree Course" } });
    return db.contentItem.create({
      data: {
        tenantId,
        courseId: course.id,
        kind: "folder",
        title: "Fixture Folder",
        sortOrder: 0,
        depth: 1,
      },
    });
  },
  LessonProgress: async (db, tenantId) => {
    const user = await db.user.create({
      data: { email: `fixture-learner-${randomUUID()}@example.com`, name: "Fixture Learner" },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, role: "student" },
    });
    const course = await db.course.create({ data: { tenantId, title: "Fixture Progress Course" } });
    const item = await db.contentItem.create({
      data: { tenantId, courseId: course.id, kind: "folder", title: "x", sortOrder: 0, depth: 1 },
    });
    return db.lessonProgress.create({
      data: {
        tenantId,
        membershipId: membership.id,
        contentItemId: item.id,
        videoPositionSec: 42,
      },
    });
  },
  QuestionBank: (db, tenantId) =>
    db.questionBank.create({
      data: {
        tenantId,
        title: "Fixture Question Bank",
      },
    }),
  Question: async (db, tenantId) => {
    const bank = await db.questionBank.create({
      data: { tenantId, title: "Fixture Bank for Question" },
    });
    return db.question.create({
      data: {
        tenantId,
        bankId: bank.id,
        type: "single",
        text: "What is 2 + 2?",
        marks: 1,
        difficulty: "easy",
      },
    });
  },
  QuestionOption: async (db, tenantId) => {
    const bank = await db.questionBank.create({
      data: { tenantId, title: "Fixture Bank for Option" },
    });
    const question = await db.question.create({
      data: {
        tenantId,
        bankId: bank.id,
        type: "single",
        text: "What is 2 + 2?",
        marks: 1,
        difficulty: "easy",
      },
    });
    return db.questionOption.create({
      data: {
        tenantId,
        questionId: question.id,
        text: "4",
        isCorrect: true,
        sortOrder: 0,
      },
    });
  },
  Quiz: async (db, tenantId) => {
    const course = await db.course.create({ data: { tenantId, title: "Fixture Quiz Course" } });
    return db.quiz.create({
      data: {
        tenantId,
        courseId: course.id,
        title: "Fixture Quiz",
        durationMin: 30,
        passMark: 50,
        opensAt: new Date(),
      },
    });
  },
  QuizTarget: async (db, tenantId) => {
    const course = await db.course.create({ data: { tenantId, title: "Fixture Target Course" } });
    const item = await db.contentItem.create({
      data: {
        tenantId,
        courseId: course.id,
        kind: "folder",
        title: "Fixture Target Folder",
        sortOrder: 0,
        depth: 1,
      },
    });
    const quiz = await db.quiz.create({
      data: {
        tenantId,
        courseId: course.id,
        title: "Fixture Quiz for Target",
        durationMin: 30,
        passMark: 50,
        opensAt: new Date(),
      },
    });
    return db.quizTarget.create({
      data: {
        tenantId,
        quizId: quiz.id,
        contentItemId: item.id,
      },
    });
  },
  QuizQuestion: async (db, tenantId) => {
    const course = await db.course.create({ data: { tenantId, title: "Fixture QQ Course" } });
    const bank = await db.questionBank.create({
      data: { tenantId, title: "Fixture QQ Bank" },
    });
    const question = await db.question.create({
      data: {
        tenantId,
        bankId: bank.id,
        type: "single",
        text: "Fixture Question for QQ",
        marks: 1,
        difficulty: "easy",
      },
    });
    const quiz = await db.quiz.create({
      data: {
        tenantId,
        courseId: course.id,
        title: "Fixture Quiz for QQ",
        durationMin: 30,
        passMark: 50,
        opensAt: new Date(),
      },
    });
    return db.quizQuestion.create({
      data: {
        tenantId,
        quizId: quiz.id,
        questionId: question.id,
        sortOrder: 0,
      },
    });
  },
  Attempt: async (db, tenantId) => {
    const user = await db.user.create({
      data: { email: `fixture-attempt-${randomUUID()}@example.com`, name: "Attempt Student" },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, role: "student" },
    });
    const device = await db.device.create({
      data: { userId: user.id, status: "active", secretHash: randomUUID() },
    });
    const course = await db.course.create({ data: { tenantId, title: "Attempt Course" } });
    const quiz = await db.quiz.create({
      data: {
        tenantId,
        courseId: course.id,
        title: "Fixture Quiz for Attempt",
        durationMin: 30,
        passMark: 50,
        opensAt: new Date(),
      },
    });
    return db.attempt.create({
      data: {
        tenantId,
        quizId: quiz.id,
        membershipId: membership.id,
        deviceId: device.id,
        attemptNo: 1,
        deadlineAt: new Date(Date.now() + 1800_000),
        maxScore: 10,
        snapshot: { questions: [] },
      },
    });
  },
  AttemptAnswer: async (db, tenantId) => {
    const user = await db.user.create({
      data: { email: `fixture-ans-${randomUUID()}@example.com`, name: "Answer Student" },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, role: "student" },
    });
    const device = await db.device.create({
      data: { userId: user.id, status: "active", secretHash: randomUUID() },
    });
    const course = await db.course.create({ data: { tenantId, title: "Answer Course" } });
    const quiz = await db.quiz.create({
      data: {
        tenantId,
        courseId: course.id,
        title: "Fixture Quiz for Answer",
        durationMin: 30,
        passMark: 50,
        opensAt: new Date(),
      },
    });
    const attempt = await db.attempt.create({
      data: {
        tenantId,
        quizId: quiz.id,
        membershipId: membership.id,
        deviceId: device.id,
        attemptNo: 1,
        deadlineAt: new Date(Date.now() + 1800_000),
        maxScore: 10,
        snapshot: { questions: [] },
      },
    });
    const bank = await db.questionBank.create({ data: { tenantId, title: "Answer Bank" } });
    const question = await db.question.create({
      data: {
        tenantId,
        bankId: bank.id,
        type: "single",
        text: "Fixture Question for Answer",
        marks: 1,
      },
    });
    return db.attemptAnswer.create({
      data: {
        tenantId,
        attemptId: attempt.id,
        questionId: question.id,
        selectedOptionIds: [],
      },
    });
  },
};

export type FixtureTenant = {
  id: string;
  slug: string;
  /** Model name → id of this tenant's fixture row. */
  rows: Record<string, string>;
};

async function createFixtureTenant(db: PrismaClient, label: string): Promise<FixtureTenant> {
  const slug = `t-${label}-${randomUUID().slice(0, 8)}`;
  const tenant = await db.tenant.create({ data: { slug, name: `Tenant ${label}` } });
  const rows: Record<string, string> = {};
  for (const model of TENANT_MODELS) {
    const make = TENANT_FIXTURES[model];
    if (!make) throw new Error(`No isolation fixture for ${model}. Add one to TENANT_FIXTURES.`);
    rows[model] = (await make(db, tenant.id)).id;
  }
  return { id: tenant.id, slug: tenant.slug, rows };
}

// Two tenants with one row in every tenant-owned table. Pass the raw (unscoped) test client.
export async function createTwoTenants(db: PrismaClient) {
  const a = await createFixtureTenant(db, "a");
  const b = await createFixtureTenant(db, "b");
  return {
    a,
    b,
    // Deleting the tenants cascades to all their rows.
    cleanup: () => db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } }),
  };
}
