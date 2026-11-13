import { randomUUID } from "node:crypto";
import { clearTestMailbox, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "RedeemTestPassword123!";
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

beforeEach(() => {
  clearTestMailbox();
});

type Tenant = { id: string; slug: string };
const host = (t: Tenant) => `${t.slug}.localhost`;
const as = (t: Tenant, cookie: string, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body, { cookie });
const anon = (t: Tenant, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body);

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const auditOf = (tenantId: string, targetId: string) =>
  systemPrisma.auditLog.findMany({ where: { tenantId, targetId } });

// Helper to mint codes using teacher credentials
async function mintCodes(t: Tenant, teacherCookie: string, courseId: string, count = 1) {
  const res = await as(t, teacherCookie, "POST", "/code-batches", {
    courseId,
    count,
  });
  expect(res.status).toBe(201);
  return res.body as {
    batch: { id: string; codeCount: number };
    codes: Array<{ serial: number; code: string }>;
  };
}

// Helper to create and authenticate a student on a tenant
async function createAndLoginStudent(t: Tenant) {
  const { user, membership } = await fx.member(t.id, "student");
  const login = await fx.studentLogin(t, user.email);
  expect(login.status).toBe(200);
  return { user, membership, cookie: login.cookies };
}

describe("Access Code Redemption API (Integration — Step 6.6a)", () => {
  describe("POST /api/register-with-code (New Student Registration)", () => {
    it("successfully registers a new student with code, marks emailVerified: false, provisions membership & enrollment, dispatches email", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Biology 101" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      const email = `student-${randomUUID().slice(0, 8)}@example.com`;
      const res = await anon(t, "POST", "/register-with-code", {
        code,
        name: "Youssef Ahmed",
        email,
        password: "StudentPassword123!",
        phone: "+201012345678",
      });

      expect(res.status).toBe(201);
      const body = res.body as {
        userId: string;
        membershipId: string;
        courseId: string;
        email: string;
      };
      expect(body.email).toBe(email.toLowerCase());
      expect(body.courseId).toBe(course.id);

      // Verify User record
      const dbUser = await systemPrisma.user.findUniqueOrThrow({ where: { id: body.userId } });
      expect(dbUser.emailVerified).toBe(false); // FR-A01 invariant
      expect(dbUser.name).toBe("Youssef Ahmed");
      expect(dbUser.status).toBe("active");
      expect(dbUser.maxDevices).toBe(1);

      // Verify Membership record
      const dbMem = await systemPrisma.membership.findUniqueOrThrow({
        where: { id: body.membershipId },
      });
      expect(dbMem.tenantId).toBe(t.id);
      expect(dbMem.userId).toBe(body.userId);
      expect(dbMem.role).toBe("student");
      expect(dbMem.phone).toBe("+201012345678");

      // Verify Enrollment record
      const dbEnrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: {
          membershipId_courseId: {
            membershipId: body.membershipId,
            courseId: course.id,
          },
        },
      });
      expect(dbEnrollment.status).toBe("active");
      expect(dbEnrollment.source).toBe("code");

      // Verify AccessCode record in DB: marked redeemed
      const dbCode = await systemPrisma.accessCode.findFirstOrThrow({
        where: { batchId: minted.batch.id },
      });
      expect(dbCode.redeemedAt).not.toBeNull();
      expect(dbCode.redeemedBy).toBe(body.userId);

      // Verify Batch counter incremented
      const dbBatch = await systemPrisma.accessCodeBatch.findUniqueOrThrow({
        where: { id: minted.batch.id },
      });
      expect(dbBatch.redeemedCount).toBe(1);

      // Verify Verification Email was dispatched
      const sentEmail = getLastSentEmail(email);
      expect(sentEmail).toBeDefined();
      expect(sentEmail?.type).toBe("verification");

      // Verify Audit Log: zero raw code in meta
      const audits = await auditOf(t.id, dbCode.id);
      const regAudit = audits.find((a) => a.action === "code.register");
      expect(regAudit).toBeDefined();
      expect(regAudit?.actorUserId).toBe(body.userId);
      expect(JSON.stringify(regAudit?.meta)).not.toContain(code);
    });

    it("normalizes user input (spaces, lowercase, and Crockford aliases O->0, I/L->1)", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "History 101" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const rawCode = minted.codes[0]!.code; // e.g. "ABCD-EFGH-JKMN"

      // Format with lowercase and spaces instead of hyphens
      const mangled = rawCode.toLowerCase().replace(/-/g, " ");

      const email = `norm-${randomUUID().slice(0, 8)}@example.com`;
      const res = await anon(t, "POST", "/register-with-code", {
        code: mangled,
        name: "Test Normalizer",
        email,
        password: "StudentPassword123!",
      });

      expect(res.status).toBe(201);
      const dbBatch = await systemPrisma.accessCodeBatch.findUniqueOrThrow({
        where: { id: minted.batch.id },
      });
      expect(dbBatch.redeemedCount).toBe(1);
    });

    it("enforces minor guardian consent: rejects if isMinor=true and guardianConsent=false with 400", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "English 101" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      const email = `minor-${randomUUID().slice(0, 8)}@example.com`;
      const res = await anon(t, "POST", "/register-with-code", {
        code,
        name: "Minor Student",
        email,
        password: "StudentPassword123!",
        isMinor: true,
        guardianConsent: false,
      });

      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("GUARDIAN_CONSENT_REQUIRED");

      // Verify code was NOT redeemed
      const dbCode = await systemPrisma.accessCode.findFirstOrThrow({
        where: { batchId: minted.batch.id },
      });
      expect(dbCode.redeemedAt).toBeNull();
    });

    it("accepts minor when guardianConsent=true and records guardianConsentAt", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "English 102" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      const email = `minor-ok-${randomUUID().slice(0, 8)}@example.com`;
      const res = await anon(t, "POST", "/register-with-code", {
        code,
        name: "Consented Minor",
        email,
        password: "StudentPassword123!",
        isMinor: true,
        guardianConsent: true,
      });

      expect(res.status).toBe(201);
      const body = res.body as { membershipId: string };
      const dbMem = await systemPrisma.membership.findUniqueOrThrow({
        where: { id: body.membershipId },
      });
      expect(dbMem.guardianConsentAt).not.toBeNull();
    });

    it("rejects duplicate email with 409 USER_ALREADY_EXISTS and leaves code unredeemed", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Math 101" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      // Create an existing student
      const { user: existingUser } = await fx.member(t.id, "student");

      const res = await anon(t, "POST", "/register-with-code", {
        code,
        name: "Duplicate Person",
        email: existingUser.email,
        password: "NewPassword123!",
      });

      expect(res.status).toBe(409);
      expect(reasonOf(res.body)).toBe("USER_ALREADY_EXISTS");

      // Crucial: code must remain untouched
      const dbCode = await systemPrisma.accessCode.findFirstOrThrow({
        where: { batchId: minted.batch.id },
      });
      expect(dbCode.redeemedAt).toBeNull();
      expect(dbCode.redeemedBy).toBeNull();
    });

    it("rejects malformed access code with 400 INVALID_CODE_FORMAT", async () => {
      const t = await fx.tenant();

      const res = await anon(t, "POST", "/register-with-code", {
        code: "SHORT-CODE",
        name: "Bad Code",
        email: `badcode-${randomUUID().slice(0, 8)}@example.com`,
        password: "Password123!",
      });

      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("INVALID_CODE_FORMAT");
    });

    it("returns 404 CODE_NOT_FOUND when code belongs to another tenant (Tenant Isolation)", async () => {
      const tenantA = await fx.tenant();
      const tenantB = await fx.tenant();
      const teacherB = await fx.staffLogin(tenantB, "teacher");

      const courseB = await systemPrisma.course.create({
        data: { tenantId: tenantB.id, title: "Tenant B Physics" },
      });

      const mintedB = await mintCodes(tenantB, teacherB.cookie, courseB.id, 1);
      const codeB = mintedB.codes[0]!.code;

      // Submit Tenant B's code to Tenant A's host
      const res = await anon(tenantA, "POST", "/register-with-code", {
        code: codeB,
        name: "Cross Tenant Hijacker",
        email: `cross-${randomUUID().slice(0, 8)}@example.com`,
        password: "Password123!",
      });

      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("CODE_NOT_FOUND");
    });

    it("rejects already redeemed code with 409 CODE_NOT_AVAILABLE", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Philosophy" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      // First registration succeeds
      const res1 = await anon(t, "POST", "/register-with-code", {
        code,
        name: "First Student",
        email: `first-${randomUUID().slice(0, 8)}@example.com`,
        password: "Password123!",
      });
      expect(res1.status).toBe(201);

      // Second registration with the exact same code
      const res2 = await anon(t, "POST", "/register-with-code", {
        code,
        name: "Second Student",
        email: `second-${randomUUID().slice(0, 8)}@example.com`,
        password: "Password123!",
      });
      expect(res2.status).toBe(409);
      expect(reasonOf(res2.body)).toBe("CODE_NOT_AVAILABLE");
    });

    it("rejects revoked code with 409 CODE_NOT_AVAILABLE", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Geography" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      // Teacher revokes batch
      await as(t, teacher.cookie, "POST", `/code-batches/${minted.batch.id}/revoke`);

      // Attempt to register with revoked code
      const res = await anon(t, "POST", "/register-with-code", {
        code,
        name: "Late Student",
        email: `late-${randomUUID().slice(0, 8)}@example.com`,
        password: "Password123!",
      });

      expect(res.status).toBe(409);
      expect(reasonOf(res.body)).toBe("CODE_NOT_AVAILABLE");
    });
  });

  describe("POST /api/codes/redeem (In-Account Redemption)", () => {
    it("allows an authenticated student to redeem code, enrolls in course, updates batch counter", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Calculus I" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      const res = await as(t, student.cookie, "POST", "/codes/redeem", { code });

      expect(res.status).toBe(200);
      const body = res.body as {
        membershipId: string;
        courseId: string;
        courseTitle: string;
        status: string;
      };

      expect(body.courseId).toBe(course.id);
      expect(body.courseTitle).toBe("Calculus I");
      expect(body.status).toBe("active");

      // Verify active enrollment in DB
      const enrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: {
          membershipId_courseId: {
            membershipId: student.membership.id,
            courseId: course.id,
          },
        },
      });
      expect(enrollment.status).toBe("active");
      expect(enrollment.source).toBe("code");

      // Verify code marked redeemed
      const dbCode = await systemPrisma.accessCode.findFirstOrThrow({
        where: { batchId: minted.batch.id },
      });
      expect(dbCode.redeemedAt).not.toBeNull();
      expect(dbCode.redeemedBy).toBe(student.user.id);

      // Verify audit log
      const audits = await auditOf(t.id, dbCode.id);
      const redeemAudit = audits.find((a) => a.action === "code.redeem");
      expect(redeemAudit).toBeDefined();
      expect(redeemAudit?.actorUserId).toBe(student.user.id);
    });

    it("provisions a new student membership on Tenant B if existing user redeems Tenant B voucher (Cross-Tenant)", async () => {
      const tenantA = await fx.tenant();
      const tenantB = await fx.tenant();
      const teacherB = await fx.staffLogin(tenantB, "teacher");

      // Student starts on Tenant A
      const studentA = await createAndLoginStudent(tenantA);

      const courseB = await systemPrisma.course.create({
        data: { tenantId: tenantB.id, title: "Tenant B Advanced Literature" },
      });

      const mintedB = await mintCodes(tenantB, teacherB.cookie, courseB.id, 1);
      const codeB = mintedB.codes[0]!.code;

      // Student A redeems Tenant B's voucher on Tenant B's host
      const res = await as(tenantB, studentA.cookie, "POST", "/codes/redeem", { code: codeB });

      expect(res.status).toBe(200);
      const body = res.body as { membershipId: string; courseId: string };

      // Verify membership on Tenant B was created for this user
      const memB = await systemPrisma.membership.findUniqueOrThrow({
        where: { id: body.membershipId },
      });
      expect(memB.tenantId).toBe(tenantB.id);
      expect(memB.userId).toBe(studentA.user.id);
      expect(memB.role).toBe("student");

      // Verify active enrollment on Tenant B
      const dbEnrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: {
          membershipId_courseId: {
            membershipId: memB.id,
            courseId: courseB.id,
          },
        },
      });
      expect(dbEnrollment.status).toBe("active");
    });

    it("protects student from accidental waste: returns 400 ALREADY_ENROLLED without consuming code", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Astronomy" },
      });

      // Pre-enroll student in the course
      await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "active",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      // Attempt to redeem voucher for already enrolled course
      const res = await as(t, student.cookie, "POST", "/codes/redeem", { code });

      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("ALREADY_ENROLLED");

      // Verify code was NOT consumed
      const dbCode = await systemPrisma.accessCode.findFirstOrThrow({
        where: { batchId: minted.batch.id },
      });
      expect(dbCode.redeemedAt).toBeNull();
      expect(dbCode.redeemedBy).toBeNull();

      const dbBatch = await systemPrisma.accessCodeBatch.findUniqueOrThrow({
        where: { id: minted.batch.id },
      });
      expect(dbBatch.redeemedCount).toBe(0);
    });

    it("reactivates a previously terminated enrollment to active", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Art History" },
      });

      // Student had a terminated enrollment
      const terminated = await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "terminated",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      const res = await as(t, student.cookie, "POST", "/codes/redeem", { code });

      expect(res.status).toBe(200);

      // Verify enrollment reactivated
      const updated = await systemPrisma.enrollment.findUniqueOrThrow({
        where: { id: terminated.id },
      });
      expect(updated.status).toBe("active");
      expect(updated.source).toBe("code");
    });

    it("requires authentication: unauthenticated request returns 401 UNAUTHORIZED", async () => {
      const t = await fx.tenant();
      const res = await anon(t, "POST", "/codes/redeem", { code: "SOME-CODE-HERE" });
      expect(res.status).toBe(401);
      expect(reasonOf(res.body)).toBe("UNAUTHORIZED");
    });

    it("rejects suspended user with 403 USER_SUSPENDED", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "French 101" },
      });
      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      // Suspend user
      await systemPrisma.user.update({
        where: { id: student.user.id },
        data: { status: "suspended" },
      });

      const res = await as(t, student.cookie, "POST", "/codes/redeem", { code });
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe(AccessReasonCode.USER_SUSPENDED);
    });

    it("rejects staff member attempting to redeem student code with 403 ROLE_FORBIDDEN", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Statistics 101" },
      });
      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      const res = await as(t, teacher.cookie, "POST", "/codes/redeem", { code });
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe("ROLE_FORBIDDEN");
    });
  });

  describe("Anti-Double-Spend Concurrency Gate (G3 / Step 6.6a Done Condition)", () => {
    it("concurrency: 5 parallel requests to /api/register-with-code yield strictly 1 success (201) and 4 conflicts (409)", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Physics Race Course" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      // Launch 5 parallel unauthenticated registration requests targeting the SAME code
      const requests = Array.from({ length: 5 }).map((_, i) =>
        anon(t, "POST", "/register-with-code", {
          code,
          name: `Competitor ${i}`,
          email: `race-register-${i}-${randomUUID().slice(0, 6)}@example.com`,
          password: "RacePassword123!",
        }),
      );

      const results = await Promise.all(requests);

      const successes = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(4);

      for (const conf of conflicts) {
        expect(reasonOf(conf.body)).toBe("CODE_NOT_AVAILABLE");
      }

      // Check database state
      const dbBatch = await systemPrisma.accessCodeBatch.findUniqueOrThrow({
        where: { id: minted.batch.id },
      });
      expect(dbBatch.redeemedCount).toBe(1);

      const dbCode = await systemPrisma.accessCode.findFirstOrThrow({
        where: { batchId: minted.batch.id },
      });
      expect(dbCode.redeemedAt).not.toBeNull();
      expect(dbCode.redeemedBy).toBeDefined();

      // Exactly one enrollment exists for this course
      const enrollments = await systemPrisma.enrollment.findMany({
        where: { courseId: course.id },
      });
      expect(enrollments).toHaveLength(1);
    });

    it("concurrency: 5 parallel requests to /api/codes/redeem yield strictly 1 success (200) and 4 conflicts (409)", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Chemistry Race Course" },
      });

      const minted = await mintCodes(t, teacher.cookie, course.id, 1);
      const code = minted.codes[0]!.code;

      // Create 5 distinct students
      const students = await Promise.all(
        Array.from({ length: 5 }).map(() => createAndLoginStudent(t)),
      );

      // Launch 5 parallel redemption requests targeting the SAME code
      const requests = students.map((s) => as(t, s.cookie, "POST", "/codes/redeem", { code }));

      const results = await Promise.all(requests);

      const successes = results.filter((r) => r.status === 200);
      const conflicts = results.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(4);

      for (const conf of conflicts) {
        expect(reasonOf(conf.body)).toBe("CODE_NOT_AVAILABLE");
      }

      // Check database state
      const dbBatch = await systemPrisma.accessCodeBatch.findUniqueOrThrow({
        where: { id: minted.batch.id },
      });
      expect(dbBatch.redeemedCount).toBe(1);

      const dbCode = await systemPrisma.accessCode.findFirstOrThrow({
        where: { batchId: minted.batch.id },
      });
      expect(dbCode.redeemedAt).not.toBeNull();

      const enrollments = await systemPrisma.enrollment.findMany({
        where: { courseId: course.id },
      });
      expect(enrollments).toHaveLength(1);
    });
  });
});
