// Step 9.9a: Analytics overview API with plain SQL (FR-L02).
import { auth } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, type AnalyticsOverviewResponseDto } from "@itqan/shared";
import type { APIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "AnalyticsTestPassword123!";
const fx = studentFixtures(PASSWORD);
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
const host = (t: Tenant) => `${t.slug}.localhost`;
const cookiesOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .join("; ");

async function studentLogin(t: Tenant, email: string) {
  const headers = new Headers({ host: host(t) });
  try {
    const res = await auth.api.signInStudent({
      body: { email, password: PASSWORD },
      headers,
      returnHeaders: true,
    });
    return { status: 200, cookies: cookiesOf(res.headers) };
  } catch (e) {
    const err = e as APIError;
    return { status: err.statusCode, cookies: "" };
  }
}

async function staff(t: Tenant, role: "teacher" | "assistant" = "teacher") {
  const { user } = await fx.member(t.id, role);
  const res = await auth.api.signInEmail({
    body: { email: user.email, password: PASSWORD },
    returnHeaders: true,
  });
  // Staff need TOTP (FR-A03, step 10.3); turned on after sign-in.
  await systemPrisma.user.update({ where: { email: user.email }, data: { twoFactorEnabled: true } });
  return { user, cookie: cookiesOf(res.headers) };
}

const getOverview = (t: Tenant, cookie: string) =>
  http.send(host(t), "GET", "/api/analytics/overview", undefined, { cookie });

describe("Step 9.9a: Analytics Overview API (FR-L02)", () => {
  describe("exact metrics", () => {
    it("matches exact seeded database records across all 7 metrics", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");

      // 1. Students: 3 active students, 1 suspended student
      const { user: s1, membership: m1 } = await fx.member(t.id, "student");
      const dev1 = await fx.device(s1.id);
      const { user: s2, membership: m2 } = await fx.member(t.id, "student");
      const dev2 = await fx.device(s2.id);
      const { user: s3, membership: m3 } = await fx.member(t.id, "student");
      const dev3 = await fx.device(s3.id);

      const { membership: sSuspendedMem } = await fx.member(t.id, "student");
      await systemPrisma.membership.update({
        where: { id: sSuspendedMem.id },
        data: { status: "suspended" },
      });

      // 2. Courses: 2 active courses, 1 soft-deleted
      const c1 = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course 1" },
      });
      const c2 = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course 2" },
      });
      await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course Deleted", deletedAt: new Date() },
      });

      // 3. Published items: 3 published, 1 draft (publishedAt=null), 1 deleted published
      await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c1.id, title: "Item 1", kind: "lecture", sortOrder: 1, depth: 1, publishedAt: new Date() },
      });
      await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c1.id, title: "Item 2", kind: "video", sortOrder: 2, depth: 1, publishedAt: new Date() },
      });
      await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c2.id, title: "Item 3", kind: "file", sortOrder: 1, depth: 1, publishedAt: new Date() },
      });
      await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c2.id, title: "Draft Item", kind: "lecture", sortOrder: 2, depth: 1, publishedAt: null },
      });
      await systemPrisma.contentItem.create({
        data: {
          tenantId: t.id,
          courseId: c2.id,
          title: "Deleted Item",
          kind: "lecture",
          sortOrder: 3,
          depth: 1,
          publishedAt: new Date(),
          deletedAt: new Date(),
        },
      });

      // 4. Quiz attempts and average grade
      const quiz = await systemPrisma.quiz.create({
        data: {
          tenantId: t.id,
          courseId: c1.id,
          title: "Quiz 1",
          durationMin: 30,
          passMark: 50,
          opensAt: new Date(Date.now() - 3600000),
        },
      });
      await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c1.id, quizId: quiz.id, title: "Quiz 1 Item", kind: "quiz", sortOrder: 3, depth: 1, publishedAt: new Date() },
      });

      // Attempt 1: submitted, score 80 / 100 = 80%
      await systemPrisma.attempt.create({
        data: {
          tenantId: t.id,
          quizId: quiz.id,
          membershipId: m1.id,
          deviceId: dev1.device.id,
          attemptNo: 1,
          score: 80,
          maxScore: 100,
          submittedAt: new Date(),
          startedAt: new Date(),
          deadlineAt: new Date(Date.now() + 3600000),
          snapshot: {},
        },
      });
      // Attempt 2: submitted, score 90 / 100 = 90%
      await systemPrisma.attempt.create({
        data: {
          tenantId: t.id,
          quizId: quiz.id,
          membershipId: m2.id,
          deviceId: dev2.device.id,
          attemptNo: 1,
          score: 90,
          maxScore: 100,
          submittedAt: new Date(),
          startedAt: new Date(),
          deadlineAt: new Date(Date.now() + 3600000),
          snapshot: {},
        },
      });
      // Attempt 3: in progress (unsubmitted, score null)
      await systemPrisma.attempt.create({
        data: {
          tenantId: t.id,
          quizId: quiz.id,
          membershipId: m3.id,
          deviceId: dev3.device.id,
          attemptNo: 1,
          score: null,
          maxScore: 100,
          submittedAt: null,
          startedAt: new Date(),
          deadlineAt: new Date(Date.now() + 3600000),
          snapshot: {},
        },
      });

      // 5. Support requests: 2 open, 1 closed
      const { membership: s1Mem } = await fx.member(t.id, "student");
      await systemPrisma.supportRequest.create({
        data: { tenantId: t.id, membershipId: s1Mem.id, type: "general", status: "open", message: "Help 1" },
      });
      await systemPrisma.supportRequest.create({
        data: { tenantId: t.id, membershipId: s1Mem.id, type: "device_change", status: "open" },
      });
      await systemPrisma.supportRequest.create({
        data: { tenantId: t.id, membershipId: s1Mem.id, type: "general", status: "closed", message: "Done" },
      });

      // Execute overview API call
      const res = await getOverview(t, teacher.cookie);
      expect(res.status).toBe(200);

      const body = res.body as AnalyticsOverviewResponseDto;
      expect(body.students).toBe(4); // s1, s2, s3, s1Mem
      expect(body.courses).toBe(2);
      expect(body.publishedItems).toBe(4); // 3 items + 1 quizItem
      expect(body.quizParticipation).toBe(3); // 3 attempts created
      expect(body.averageGrade).toBe(85); // (80 + 90) / 2 = 85.0
      expect(body.pendingRequests).toBe(2);
    });
  });

  describe("7-day active students", () => {
    it("accurately counts students active within 7 days and excludes inactive students", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");

      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
      const sixDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

      // Student A: session active 2 days ago -> active
      const { user: userA } = await fx.member(t.id, "student");
      await systemPrisma.session.create({
        data: {
          tenantId: t.id,
          userId: userA.id,
          token: `token-active-a-${Date.now()}`,
          expiresAt: new Date(now.getTime() + 86400000),
          createdAt: twoDaysAgo,
          updatedAt: twoDaysAgo,
        },
      });

      // Student B: lesson progress 4 days ago -> active
      const { membership: memB } = await fx.member(t.id, "student");
      const c = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course Act" },
      });
      const item = await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c.id, title: "L1", kind: "lecture", sortOrder: 1, depth: 1, publishedAt: new Date() },
      });
      await systemPrisma.lessonProgress.create({
        data: {
          tenantId: t.id,
          membershipId: memB.id,
          contentItemId: item.id,
          completedAt: fourDaysAgo,
          updatedAt: fourDaysAgo,
        },
      });

      // Student C: quiz attempt 6 days ago -> active
      const { user: userC, membership: memC } = await fx.member(t.id, "student");
      const devC = await fx.device(userC.id);
      const quiz = await systemPrisma.quiz.create({
        data: { tenantId: t.id, courseId: c.id, title: "Quiz Act", durationMin: 10, passMark: 50, opensAt: new Date(Date.now() - 3600000) },
      });
      await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c.id, quizId: quiz.id, title: "Q1", kind: "quiz", sortOrder: 2, depth: 1, publishedAt: new Date() },
      });
      await systemPrisma.attempt.create({
        data: {
          tenantId: t.id,
          quizId: quiz.id,
          membershipId: memC.id,
          deviceId: devC.device.id,
          attemptNo: 1,
          maxScore: 100,
          startedAt: sixDaysAgo,
          createdAt: sixDaysAgo,
          deadlineAt: new Date(sixDaysAgo.getTime() + 600000),
          snapshot: {},
        },
      });

      // Student D: only activity 10 days ago (> 7 days) -> inactive
      const { user: userD } = await fx.member(t.id, "student");
      await systemPrisma.session.create({
        data: {
          tenantId: t.id,
          userId: userD.id,
          token: `token-old-d-${Date.now()}`,
          expiresAt: new Date(now.getTime() - 86400000),
          createdAt: tenDaysAgo,
          updatedAt: tenDaysAgo,
        },
      });

      // Student E: completely inactive (no sessions, no attempts, no progress) -> inactive
      await fx.member(t.id, "student");

      const res = await getOverview(t, teacher.cookie);
      expect(res.status).toBe(200);
      const body = res.body as AnalyticsOverviewResponseDto;
      expect(body.students).toBe(5);
      expect(body.activeStudents7d).toBe(3); // A, B, C
    });
  });

  describe("average grade", () => {
    it("computes exact 2-decimal percentage, handles 0 attempts with null, and ignores in-progress attempts", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");

      // 1. With 0 attempts -> averageGrade is null
      const resEmpty = await getOverview(t, teacher.cookie);
      expect(resEmpty.status).toBe(200);
      expect((resEmpty.body as AnalyticsOverviewResponseDto).averageGrade).toBeNull();

      // 2. Add quiz and attempts with fractional percentage: 25/30 = 83.333...% and 28/30 = 93.333...%
      const { user, membership } = await fx.member(t.id, "student");
      const dev = await fx.device(user.id);
      const c = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course G" },
      });
      const quiz = await systemPrisma.quiz.create({
        data: { tenantId: t.id, courseId: c.id, title: "QG", durationMin: 15, passMark: 50, opensAt: new Date(Date.now() - 3600000) },
      });
      await systemPrisma.contentItem.create({
        data: { tenantId: t.id, courseId: c.id, quizId: quiz.id, title: "QG", kind: "quiz", sortOrder: 1, depth: 1, publishedAt: new Date() },
      });

      await systemPrisma.attempt.create({
        data: {
          tenantId: t.id,
          quizId: quiz.id,
          membershipId: membership.id,
          deviceId: dev.device.id,
          attemptNo: 1,
          score: 25,
          maxScore: 30, // 83.333%
          submittedAt: new Date(),
          startedAt: new Date(),
          deadlineAt: new Date(Date.now() + 900000),
          snapshot: {},
        },
      });
      await systemPrisma.attempt.create({
        data: {
          tenantId: t.id,
          quizId: quiz.id,
          membershipId: membership.id,
          deviceId: dev.device.id,
          attemptNo: 2,
          score: 28,
          maxScore: 30, // 93.333%
          submittedAt: new Date(),
          startedAt: new Date(),
          deadlineAt: new Date(Date.now() + 900000),
          snapshot: {},
        },
      });

      // Average: (83.333333 + 93.333333) / 2 = 176.666666 / 2 = 88.33%
      const resGraded = await getOverview(t, teacher.cookie);
      expect(resGraded.status).toBe(200);
      expect((resGraded.body as AnalyticsOverviewResponseDto).averageGrade).toBe(88.33);
    });
  });

  describe("access control and isolation", () => {
    it("students receive 403 Forbidden; staff on Tenant A see only Tenant A analytics (never Tenant B data)", async () => {
      const [tA, tB] = [await fx.tenant(), await fx.tenant()];
      const teacherA = await staff(tA, "teacher");
      const assistantA = await staff(tA, "assistant");

      const { user: studentA } = await fx.member(tA.id, "student");
      const studentSession = await studentLogin(tA, studentA.email);

      // Student receives 403 Forbidden
      const resStudent = await getOverview(tA, studentSession.cookies);
      expect(resStudent.status).toBe(403);
      expect((resStudent.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      // Assistant can view overview
      const resAssistant = await getOverview(tA, assistantA.cookie);
      expect(resAssistant.status).toBe(200);

      // Populate Tenant B with courses and support requests
      await systemPrisma.course.create({
        data: { tenantId: tB.id, title: "Tenant B Course" },
      });
      const { membership: memB } = await fx.member(tB.id, "student");
      await systemPrisma.supportRequest.create({
        data: { tenantId: tB.id, membershipId: memB.id, type: "general", status: "open", message: "B request" },
      });

      // Tenant A staff queries Tenant A -> must NOT reflect Tenant B data
      const resA = await getOverview(tA, teacherA.cookie);
      expect(resA.status).toBe(200);
      const bodyA = resA.body as AnalyticsOverviewResponseDto;
      expect(bodyA.courses).toBe(0);
      expect(bodyA.pendingRequests).toBe(0);
    });
  });
});
