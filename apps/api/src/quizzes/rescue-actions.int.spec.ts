// Step 8.12: Staff Rescue Actions Integration Tests (FR-X09, FR-X10)
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, AttemptReasonCode, type QuizCreateInput } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("RescuePass123!");
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
const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;

async function setup() {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const assistant = await fx.staffLogin(t, "assistant");

  // Two students: student1 has maxDevices: 2 to support testing device transfer
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
  const courseRes = await asTeacher("POST", "/courses", { title: "Rescue Actions Course" });
  const courseId = (courseRes.body as { id: string }).id;
  await systemPrisma.course.update({ where: { id: courseId }, data: { status: "published" } });

  // Enroll students
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

  // Create Question Bank and 2 questions
  const bankRes = await asTeacher("POST", "/question-banks", {
    courseId,
    title: "Rescue Test Question Bank",
  });
  const bankId = (bankRes.body as { id: string }).id;

  const q1Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "single",
    text: "Question 1",
    marks: 5,
    difficulty: "medium",
    options: [
      { text: "Wrong 1", isCorrect: false },
      { text: "Correct 1", isCorrect: true },
    ],
  });
  const q1Id = (q1Res.body as { id: string }).id;

  const q2Res = await asTeacher("POST", `/question-banks/${bankId}/questions`, {
    type: "true_false",
    text: "Question 2: Earth is round",
    marks: 5,
    difficulty: "easy",
    options: [
      { text: "True", isCorrect: true },
      { text: "False", isCorrect: false },
    ],
  });
  const q2Id = (q2Res.body as { id: string }).id;

  async function createQuiz(overrides: Partial<QuizCreateInput> = {}) {
    const now = Date.now();
    const payload: QuizCreateInput = {
      courseId,
      title: "Rescue Exam",
      durationMin: 30,
      passMark: 50,
      maxAttempts: 3,
      selection: "manual",
      questionIds: [q1Id, q2Id],
      shuffleQuestions: false,
      shuffleOptions: false,
      navigation: "free",
      graceSec: 10,
      gradeRelease: "on_submit",
      reviewMode: "full",
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 3_600_000).toISOString(),
      ...overrides,
    };
    const res = await asTeacher("POST", "/quizzes", payload);
    const quizId = (res.body as { id: string }).id;
    await asTeacher("POST", `/quizzes/${quizId}/publish`);
    return quizId;
  }

  return {
    t,
    teacher,
    assistant,
    student1,
    studentLogin1,
    student2,
    studentLogin2,
    courseId,
    q1Id,
    q2Id,
    asTeacher,
    asAssistant,
    asStudent1,
    asStudent2,
    createQuiz,
  };
}

describe("Step 8.12: Staff Rescue Actions (FR-X09, FR-X10)", () => {
  describe("Staff RBAC", () => {
    it("rejects anonymous and student callers on rescue endpoints with 401 and 403", async () => {
      const s = await setup();
      const quizId = await s.createQuiz();
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      expect(startRes.status).toBe(201);
      const attemptId = (startRes.body as { id: string }).id;

      // 1. Anonymous caller -> 401
      const anonExtend = await http.send(
        `${s.t.slug}.localhost`,
        "POST",
        `/api/attempts/${attemptId}/extend`,
        { extraMinutes: 10 },
      );
      expect(anonExtend.status).toBe(401);

      const anonTransfer = await http.send(
        `${s.t.slug}.localhost`,
        "POST",
        `/api/attempts/${attemptId}/move-device`,
        { newDeviceId: randomUUID() },
      );
      expect(anonTransfer.status).toBe(401);

      // 2. Student caller -> 403 ROLE_FORBIDDEN
      const studentExtend = await s.asStudent1("POST", `/attempts/${attemptId}/extend`, {
        extraMinutes: 10,
      });
      expect(studentExtend.status).toBe(403);
      expect(reasonOf(studentExtend.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      const studentTransfer = await s.asStudent1("POST", `/attempts/${attemptId}/move-device`, {
        newDeviceId: randomUUID(),
      });
      expect(studentTransfer.status).toBe(403);
      expect(reasonOf(studentTransfer.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      // 3. Teacher caller -> 200 (using both /extend and /extend-time aliases)
      const teacherExtend = await s.asTeacher("POST", `/attempts/${attemptId}/extend`, {
        extraMinutes: 10,
        reason: "Student had connectivity drop",
      });
      expect(teacherExtend.status).toBe(200);
      expect((teacherExtend.body as { success: boolean }).success).toBe(true);

      // 4. Assistant caller -> 200
      const assistantExtend = await s.asAssistant("POST", `/attempts/${attemptId}/extend-time`, {
        extraMinutes: 5,
        reason: "Assistant granted 5 extra minutes",
      });
      expect(assistantExtend.status).toBe(200);
      expect((assistantExtend.body as { extraTimeSec: number }).extraTimeSec).toBe(15 * 60); // 10 + 5 minutes
    });
  });

  describe("Time Extension and Reopen", () => {
    it("extends time for in-progress attempt, pushing remaining seconds forward and allowing autosave", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({ durationMin: 10 });
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      // Check initial remaining seconds
      const initialGet = await s.asStudent1("GET", `/attempts/${attemptId}`);
      expect(initialGet.status).toBe(200);
      const initialRemaining = (initialGet.body as { remainingSeconds: number }).remainingSeconds;
      expect(initialRemaining).toBeGreaterThanOrEqual(9 * 60);
      expect(initialRemaining).toBeLessThanOrEqual(10 * 60);

      // Teacher extends by 20 minutes (1200 seconds)
      const extendRes = await s.asTeacher("POST", `/attempts/${attemptId}/extend`, {
        extraMinutes: 20,
        reason: "Power outage at lab",
      });
      expect(extendRes.status).toBe(200);
      const extendBody = extendRes.body as {
        success: boolean;
        extraTimeSec: number;
        status: string;
        reopened: boolean;
      };
      expect(extendBody.success).toBe(true);
      expect(extendBody.extraTimeSec).toBe(1200);
      expect(extendBody.status).toBe("in_progress");
      expect(extendBody.reopened).toBe(false);

      // Student gets attempt: remaining seconds increased by ~1200s
      const updatedGet = await s.asStudent1("GET", `/attempts/${attemptId}`);
      expect(updatedGet.status).toBe(200);
      const updatedBody = updatedGet.body as {
        extraTimeSec: number;
        remainingSeconds: number;
        status: string;
      };
      expect(updatedBody.extraTimeSec).toBe(1200);
      expect(updatedBody.remainingSeconds).toBeGreaterThan(initialRemaining + 1100);
      expect(updatedBody.status).toBe("in_progress");

      // Student can autosave answers
      const saveRes = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${s.q1Id}`, {
        selectedOptionIds: [],
      });
      expect(saveRes.status).toBe(200);
    });

    it("reopens an auto-submitted/expired attempt and allows student to resume taking the quiz", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({ durationMin: 5, gradeRelease: "manual" });
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      // Simulate expired deadline in DB and auto-submit
      const pastDeadline = new Date(Date.now() - 300_000); // 5 minutes ago
      await systemPrisma.attempt.update({
        where: { id: attemptId },
        data: {
          deadlineAt: pastDeadline,
          submittedAt: pastDeadline,
          score: 0,
          passed: false,
        },
      });

      // Confirm attempt is submitted
      const submittedGet = await s.asStudent1("GET", `/attempts/${attemptId}`);
      expect(submittedGet.status).toBe(200);
      expect((submittedGet.body as { status: string }).status).toBe("submitted");

      // Trying to autosave while submitted is rejected with 400
      const saveRejected = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${s.q1Id}`, {
        selectedOptionIds: [],
      });
      expect(saveRejected.status).toBe(400);
      expect(reasonOf(saveRejected.body)).toBe(AttemptReasonCode.ATTEMPT_ALREADY_SUBMITTED);

      // Extending without reopen is rejected on submitted attempt
      const extendNoReopen = await s.asTeacher("POST", `/attempts/${attemptId}/extend`, {
        extraMinutes: 15,
        reopen: false,
      });
      expect(extendNoReopen.status).toBe(400);
      expect(reasonOf(extendNoReopen.body)).toBe(AttemptReasonCode.ATTEMPT_ALREADY_SUBMITTED);

      // Teacher rescues with reopen: true
      const rescueRes = await s.asTeacher("POST", `/attempts/${attemptId}/extend`, {
        extraMinutes: 30, // 30 minutes extra puts effective deadline into the future
        reopen: true,
        reason: "Student submitted accidentally / timed out during medical issue",
      });
      expect(rescueRes.status).toBe(200);
      const rescueBody = rescueRes.body as {
        success: boolean;
        reopened: boolean;
        status: string;
        extraTimeSec: number;
      };
      expect(rescueBody.success).toBe(true);
      expect(rescueBody.reopened).toBe(true);
      expect(rescueBody.status).toBe("in_progress");

      // Verify attempt is reopened in DB
      const dbAttempt = await systemPrisma.attempt.findUnique({ where: { id: attemptId } });
      expect(dbAttempt?.submittedAt).toBeNull();
      expect(dbAttempt?.score).toBeNull();
      expect(dbAttempt?.passed).toBeNull();

      // Student can now autosave answers!
      const saveRes = await s.asStudent1("PUT", `/attempts/${attemptId}/answers/${s.q1Id}`, {
        selectedOptionIds: [],
      });
      expect(saveRes.status).toBe(200);

      // Student can now submit normally
      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);
      expect((submitRes.body as { status: string }).status).toBe("submitted");
    });

    it("rejects reopening if quiz review and answers were already released", async () => {
      const s = await setup();
      const quizId = await s.createQuiz({
        durationMin: 10,
        gradeRelease: "on_submit",
        reviewMode: "full",
      });
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      // Submit attempt (grades and review released on submit)
      const submitRes = await s.asStudent1("POST", `/attempts/${attemptId}/submit`);
      expect(submitRes.status).toBe(200);

      // Student can view review (already released)
      const reviewRes = await s.asStudent1("GET", `/attempts/${attemptId}/review`);
      expect(reviewRes.status).toBe(200);

      // Teacher attempt to reopen must be rejected to prevent cheating
      const reopenRes = await s.asTeacher("POST", `/attempts/${attemptId}/extend`, {
        extraMinutes: 10,
        reopen: true,
      });
      expect(reopenRes.status).toBe(400);
      expect(reasonOf(reopenRes.body)).toBe(AttemptReasonCode.ATTEMPT_CANNOT_REOPEN);
    });
  });

  describe("Device Transfer and Rebinding", () => {
    it("rebinds attempt to a student's new device, enabling new device and blocking old device", async () => {
      const s = await setup();
      const quizId = await s.createQuiz();
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      expect(startRes.status).toBe(201);
      const attemptId = (startRes.body as { id: string }).id;

      // Student starts on Device 1 (default from s.studentLogin1)
      const dev1Get = await s.asStudent1("GET", `/attempts/${attemptId}`);
      expect(dev1Get.status).toBe(200);

      // Student ends session on Device 1 and logs into Device 2
      await systemPrisma.session.deleteMany({ where: { userId: s.student1.user.id } });
      const dev2 = await fx.device(s.student1.user.id, "active");
      const studentLoginDev2 = await fx.studentLogin(s.t, s.student1.user.email, dev2.cookie);
      expect(studentLoginDev2.status).toBe(200);

      const asStudent1Dev2 = (method: string, path: string, body?: unknown) =>
        http.send(`${s.t.slug}.localhost`, method, `/api${path}`, body, {
          cookie: studentLoginDev2.cookies,
        });

      // Before transfer: Device 2 gets 403 ATTEMPT_DEVICE_MISMATCH
      const dev2PreMismatch = await asStudent1Dev2("GET", `/attempts/${attemptId}`);
      expect(dev2PreMismatch.status).toBe(403);
      expect(reasonOf(dev2PreMismatch.body)).toBe(AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH);

      const dev2SaveMismatch = await asStudent1Dev2(
        "PUT",
        `/attempts/${attemptId}/answers/${s.q1Id}`,
        { selectedOptionIds: [] },
      );
      expect(dev2SaveMismatch.status).toBe(403);
      expect(reasonOf(dev2SaveMismatch.body)).toBe(AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH);

      // Teacher rescues student by moving attempt to Device 2
      const transferRes = await s.asTeacher("POST", `/attempts/${attemptId}/move-device`, {
        newDeviceId: dev2.device.id,
        reason: "Laptop battery died, switched to backup laptop",
      });
      expect(transferRes.status).toBe(200);
      const transferBody = transferRes.body as {
        success: boolean;
        previousDeviceId: string;
        newDeviceId: string;
      };
      expect(transferBody.success).toBe(true);
      expect(transferBody.newDeviceId).toBe(dev2.device.id);

      // After transfer: Device 2 can view attempt and save answers!
      const dev2Success = await asStudent1Dev2("GET", `/attempts/${attemptId}`);
      expect(dev2Success.status).toBe(200);

      const dev2SaveSuccess = await asStudent1Dev2(
        "PUT",
        `/attempts/${attemptId}/answers/${s.q1Id}`,
        { selectedOptionIds: [] },
      );
      expect(dev2SaveSuccess.status).toBe(200);

      // Device 2 submits successfully
      const dev2SubmitSuccess = await asStudent1Dev2("POST", `/attempts/${attemptId}/submit`);
      expect(dev2SubmitSuccess.status).toBe(200);

      // Old device (Device 1) has its session terminated or is rejected
      const dev1PostSubmit = await s.asStudent1("GET", `/attempts/${attemptId}`);
      // Either 401 (session deleted) or 403 (device mismatch)
      expect([401, 403]).toContain(dev1PostSubmit.status);
    });
  });

  describe("Device Validation and Multi-Tenant Isolation", () => {
    it("rejects transfer to non-existent, inactive, or another student's device", async () => {
      const s = await setup();
      const quizId = await s.createQuiz();
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      // 1. Non-existent device -> 404 DEVICE_NOT_FOUND
      const nonExistent = await s.asTeacher("POST", `/attempts/${attemptId}/move-device`, {
        newDeviceId: randomUUID(),
      });
      expect(nonExistent.status).toBe(404);
      expect(reasonOf(nonExistent.body)).toBe(AttemptReasonCode.DEVICE_NOT_FOUND);

      // 2. Another student's device -> 404 DEVICE_NOT_FOUND (cannot steal devices)
      const student2Dev = await fx.device(s.student2.user.id, "active");
      const otherStudentDevRes = await s.asTeacher("POST", `/attempts/${attemptId}/move-device`, {
        newDeviceId: student2Dev.device.id,
      });
      expect(otherStudentDevRes.status).toBe(404);
      expect(reasonOf(otherStudentDevRes.body)).toBe(AttemptReasonCode.DEVICE_NOT_FOUND);

      // 3. Inactive/revoked device -> 400 INVALID_DEVICE_STATUS
      const revokedDev = await fx.device(s.student1.user.id, "revoked");
      const revokedRes = await s.asTeacher("POST", `/attempts/${attemptId}/move-device`, {
        newDeviceId: revokedDev.device.id,
      });
      expect(revokedRes.status).toBe(400);
      expect(reasonOf(revokedRes.body)).toBe(AttemptReasonCode.INVALID_DEVICE_STATUS);
    });

    it("enforces multi-tenant isolation on rescue actions", async () => {
      const s = await setup();
      const otherTenant = await fx.tenant();
      const otherTeacher = await fx.staffLogin(otherTenant, "teacher");

      const quizId = await s.createQuiz();
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      // Other tenant teacher tries to extend attempt from tenant 1 -> 404 ATTEMPT_NOT_FOUND
      const crossExtend = await http.send(
        `${otherTenant.slug}.localhost`,
        "POST",
        `/api/attempts/${attemptId}/extend`,
        { extraMinutes: 10 },
        { cookie: otherTeacher.cookie },
      );
      expect(crossExtend.status).toBe(404);
      expect(reasonOf(crossExtend.body)).toBe(AttemptReasonCode.ATTEMPT_NOT_FOUND);

      // Other tenant teacher tries to move device of attempt from tenant 1 -> 404 ATTEMPT_NOT_FOUND
      const crossTransfer = await http.send(
        `${otherTenant.slug}.localhost`,
        "POST",
        `/api/attempts/${attemptId}/move-device`,
        { newDeviceId: randomUUID() },
        { cookie: otherTeacher.cookie },
      );
      expect(crossTransfer.status).toBe(404);
      expect(reasonOf(crossTransfer.body)).toBe(AttemptReasonCode.ATTEMPT_NOT_FOUND);
    });
  });

  describe("Audit Logging", () => {
    it("records full audit trail for attempt.extend_time and attempt.move_device", async () => {
      const s = await setup();
      const quizId = await s.createQuiz();
      const startRes = await s.asStudent1("POST", `/quizzes/${quizId}/attempts`);
      const attemptId = (startRes.body as { id: string }).id;

      // 1. Extend time with audit check
      await s.asTeacher("POST", `/attempts/${attemptId}/extend`, {
        extraMinutes: 12,
        reason: "Audio driver malfunction during listening test",
      });

      const extendAudit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: s.t.id,
          action: "attempt.extend_time",
          targetId: attemptId,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(extendAudit).toBeDefined();
      expect(extendAudit?.actorUserId).toBe(s.teacher.user.id);
      const extendMeta = extendAudit?.meta as Record<string, unknown>;
      expect(extendMeta.secondsAdded).toBe(12 * 60);
      expect(extendMeta.newExtraTimeSec).toBe(12 * 60);
      expect(extendMeta.reason).toBe("Audio driver malfunction during listening test");
      expect(extendMeta.reopened).toBe(false);

      // 2. Move device with audit check
      const dev2 = await fx.device(s.student1.user.id, "active");
      await s.asAssistant("POST", `/attempts/${attemptId}/move-device`, {
        newDeviceId: dev2.device.id,
        reason: "Student moved to lab desktop #4",
      });

      const transferAudit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: s.t.id,
          action: "attempt.move_device",
          targetId: attemptId,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(transferAudit).toBeDefined();
      expect(transferAudit?.actorUserId).toBe(s.assistant.user.id);
      const transferMeta = transferAudit?.meta as Record<string, unknown>;
      expect(transferMeta.newDeviceId).toBe(dev2.device.id);
      expect(transferMeta.reason).toBe("Student moved to lab desktop #4");
      expect(transferMeta.studentUserId).toBe(s.student1.user.id);
    });
  });
});
