import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "EnrollmentTestPassword123!";
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
const as = (t: Tenant, cookie: string, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body, { cookie });
const anon = (t: Tenant, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body);

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const auditOf = (tenantId: string, targetId: string) =>
  systemPrisma.auditLog.findMany({ where: { tenantId, targetId } });

async function createAndLoginStudent(t: Tenant) {
  const { user, membership } = await fx.member(t.id, "student");
  const login = await fx.studentLogin(t, user.email);
  expect(login.status).toBe(200);
  return { user, membership, cookie: login.cookies };
}

describe("Enrollments API (Integration — Step 6.7)", () => {
  describe("POST /api/students/:membershipId/enrollments (Manual Grant)", () => {
    it("allows teacher to manually grant course enrollment to a student", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Modern Physics" },
      });

      const res = await as(
        t,
        teacher.cookie,
        "POST",
        `/students/${student.membership.id}/enrollments`,
        { courseId: course.id },
      );

      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        membershipId: string;
        courseId: string;
        status: string;
        source: string;
      };

      expect(body.membershipId).toBe(student.membership.id);
      expect(body.courseId).toBe(course.id);
      expect(body.status).toBe("active");
      expect(body.source).toBe("manual");

      // Verify DB record
      const dbEnrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(dbEnrollment.tenantId).toBe(t.id);
      expect(dbEnrollment.grantedBy).toBe(teacher.user.id);

      // Verify audit log
      const audits = await auditOf(t.id, body.id);
      const grantAudit = audits.find((a) => a.action === "enrollment.grant");
      expect(grantAudit).toBeDefined();
      expect(grantAudit?.actorUserId).toBe(teacher.user.id);
    });

    it("allows assistant to manually grant course enrollment to a student", async () => {
      const t = await fx.tenant();
      const assistant = await fx.staffLogin(t, "assistant");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Modern Organic Chemistry" },
      });

      const res = await as(
        t,
        assistant.cookie,
        "POST",
        `/students/${student.membership.id}/enrollments`,
        { courseId: course.id },
      );

      expect(res.status).toBe(201);
      const body = res.body as { status: string; source: string };
      expect(body.status).toBe("active");
      expect(body.source).toBe("manual");
    });

    it("rejects duplicate active enrollment with 400 ALREADY_ENROLLED", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Calculus II" },
      });

      // Grant first time
      const res1 = await as(
        t,
        teacher.cookie,
        "POST",
        `/students/${student.membership.id}/enrollments`,
        { courseId: course.id },
      );
      expect(res1.status).toBe(201);

      // Grant second time -> 400
      const res2 = await as(
        t,
        teacher.cookie,
        "POST",
        `/students/${student.membership.id}/enrollments`,
        { courseId: course.id },
      );
      expect(res2.status).toBe(400);
      expect(reasonOf(res2.body)).toBe("ALREADY_ENROLLED");
    });

    it("reactivates a previously terminated enrollment to active with source: manual", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Ancient Philosophy" },
      });

      // Terminated enrollment exists
      const terminated = await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "terminated",
          source: "code",
          grantedBy: teacher.user.id,
          terminatedBy: teacher.user.id,
          terminatedAt: new Date(),
        },
      });

      // Manual grant reactivates it
      const res = await as(
        t,
        teacher.cookie,
        "POST",
        `/students/${student.membership.id}/enrollments`,
        { courseId: course.id },
      );

      expect(res.status).toBe(201);
      const body = res.body as { id: string; status: string; source: string };
      expect(body.id).toBe(terminated.id);
      expect(body.status).toBe("active");
      expect(body.source).toBe("manual");

      const dbEnrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: { id: terminated.id },
      });
      expect(dbEnrollment.status).toBe("active");
      expect(dbEnrollment.terminatedAt).toBeNull();
      expect(dbEnrollment.terminatedBy).toBeNull();
    });

    it("rejects granting enrollment to non-student staff membership with 400 INVALID_TARGET_ROLE", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const { membership: assistantMem } = await fx.member(t.id, "assistant");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Grammar 101" },
      });

      const res = await as(t, teacher.cookie, "POST", `/students/${assistantMem.id}/enrollments`, {
        courseId: course.id,
      });
      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("INVALID_TARGET_ROLE");
    });

    it("rejects nonexistent course with 404 COURSE_NOT_FOUND", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const res = await as(
        t,
        teacher.cookie,
        "POST",
        `/students/${student.membership.id}/enrollments`,
        { courseId: randomUUID() },
      );
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("COURSE_NOT_FOUND");
    });

    it("returns 404 when target student belongs to another tenant (Tenant Isolation)", async () => {
      const tenantA = await fx.tenant();
      const tenantB = await fx.tenant();
      const teacherA = await fx.staffLogin(tenantA, "teacher");
      const studentB = await createAndLoginStudent(tenantB);

      const courseA = await systemPrisma.course.create({
        data: { tenantId: tenantA.id, title: "Tenant A Course" },
      });

      // Teacher A tries to enroll Student B on Tenant A's host
      const res = await as(
        tenantA,
        teacherA.cookie,
        "POST",
        `/students/${studentB.membership.id}/enrollments`,
        { courseId: courseA.id },
      );
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("MEMBERSHIP_NOT_FOUND");
    });

    it("rejects student caller attempting to grant enrollment with 403 ROLE_FORBIDDEN", async () => {
      const t = await fx.tenant();
      const student = await createAndLoginStudent(t);
      const otherStudent = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "History 201" },
      });

      const res = await as(
        t,
        student.cookie,
        "POST",
        `/students/${otherStudent.membership.id}/enrollments`,
        { courseId: course.id },
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/enrollments/:id (Termination)", () => {
    it("allows teacher to terminate an enrollment, preserves history and records audit", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Cell Biology" },
      });

      const enrollment = await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "active",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      const res = await as(t, teacher.cookie, "DELETE", `/enrollments/${enrollment.id}`);
      expect(res.status).toBe(200);
      const body = res.body as {
        id: string;
        status: string;
        terminatedAt: string;
        terminatedBy: string;
      };
      expect(body.status).toBe("terminated");
      expect(body.terminatedBy).toBe(teacher.user.id);
      expect(body.terminatedAt).toBeDefined();

      // Verify row is still preserved in DB (never hard deleted, FR-E05)
      const dbEnrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      expect(dbEnrollment.status).toBe("terminated");
      expect(dbEnrollment.terminatedBy).toBe(teacher.user.id);

      // Verify audit log
      const audits = await auditOf(t.id, enrollment.id);
      const termAudit = audits.find((a) => a.action === "enrollment.terminate");
      expect(termAudit).toBeDefined();
      expect(termAudit?.actorUserId).toBe(teacher.user.id);
    });

    it("allows super admin to terminate an enrollment", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const superAdmin = await fx.staffLogin(t, "teacher", { superAdmin: true });
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Robotics 101" },
      });

      const enrollment = await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "active",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      const res = await as(t, superAdmin.cookie, "DELETE", `/enrollments/${enrollment.id}`);
      expect(res.status).toBe(200);
      expect((res.body as { status: string }).status).toBe("terminated");
    });

    it("strictly blocks assistants from terminating enrollments with 403 ROLE_FORBIDDEN (FR-E05)", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Chemistry Lab" },
      });

      const enrollment = await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "active",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      // Assistant attempts termination -> 403
      const res = await as(t, assistant.cookie, "DELETE", `/enrollments/${enrollment.id}`);
      expect(res.status).toBe(403);

      // Enrollment must remain active
      const dbEnrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      expect(dbEnrollment.status).toBe("active");
    });

    it("strictly blocks students from terminating enrollments with 403 ROLE_FORBIDDEN", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "English Poetry" },
      });

      const enrollment = await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "active",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      const res = await as(t, student.cookie, "DELETE", `/enrollments/${enrollment.id}`);
      expect(res.status).toBe(403);
    });

    it("rejects already terminated enrollment with 400 ENROLLMENT_ALREADY_TERMINATED", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Algebra" },
      });

      const enrollment = await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "terminated",
          source: "manual",
          grantedBy: teacher.user.id,
          terminatedBy: teacher.user.id,
          terminatedAt: new Date(),
        },
      });

      const res = await as(t, teacher.cookie, "DELETE", `/enrollments/${enrollment.id}`);
      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("ENROLLMENT_ALREADY_TERMINATED");
    });

    it("returns 404 when attempting to terminate an enrollment belonging to another tenant", async () => {
      const tenantA = await fx.tenant();
      const tenantB = await fx.tenant();
      const teacherA = await fx.staffLogin(tenantA, "teacher");
      const teacherB = await fx.staffLogin(tenantB, "teacher");
      const studentB = await createAndLoginStudent(tenantB);

      const courseB = await systemPrisma.course.create({
        data: { tenantId: tenantB.id, title: "Tenant B Geometry" },
      });

      const enrollmentB = await systemPrisma.enrollment.create({
        data: {
          tenantId: tenantB.id,
          membershipId: studentB.membership.id,
          courseId: courseB.id,
          status: "active",
          source: "manual",
          grantedBy: teacherB.user.id,
        },
      });

      // Teacher A tries to delete Tenant B's enrollment
      const res = await as(tenantA, teacherA.cookie, "DELETE", `/enrollments/${enrollmentB.id}`);
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("ENROLLMENT_NOT_FOUND");
    });
  });

  describe("GET /api/courses/:id/access (Access Gate / Content Check)", () => {
    it("returns 200 with access: true when student holds active enrollment", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Data Science" },
      });

      // Grant active enrollment
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

      const res = await as(t, student.cookie, "GET", `/courses/${course.id}/access`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        access: true,
        courseId: course.id,
        status: "active",
      });
    });

    it("returns 403 ENROLLMENT_TERMINATED when student enrollment is terminated (Done Condition)", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Machine Learning" },
      });

      // Terminated enrollment
      await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "terminated",
          source: "manual",
          grantedBy: teacher.user.id,
          terminatedBy: teacher.user.id,
          terminatedAt: new Date(),
        },
      });

      const res = await as(t, student.cookie, "GET", `/courses/${course.id}/access`);
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe("ENROLLMENT_TERMINATED");
    });

    it("returns 403 ENROLLMENT_REQUIRED when student has never enrolled", async () => {
      const t = await fx.tenant();
      const student = await createAndLoginStudent(t);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Art & Design" },
      });

      const res = await as(t, student.cookie, "GET", `/courses/${course.id}/access`);
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe("ENROLLMENT_REQUIRED");
    });

    it("returns 401 when unauthenticated", async () => {
      const t = await fx.tenant();
      const res = await anon(t, "GET", `/courses/${randomUUID()}/access`);
      expect(res.status).toBe(401);
    });
  });
});
