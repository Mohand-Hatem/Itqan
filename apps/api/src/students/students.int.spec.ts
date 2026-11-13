import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "StudentDirPassword123!";
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

async function createAndLoginStudent(t: Tenant, name = "Test Student", phone = "+201000000000") {
  const { user, membership } = await fx.member(t.id, "student");
  // Update details
  await systemPrisma.user.update({
    where: { id: user.id },
    data: { name },
  });
  await systemPrisma.membership.update({
    where: { id: membership.id },
    data: { phone },
  });
  const login = await fx.studentLogin(t, user.email);
  return { user, membership, cookie: login.cookies };
}

describe("Students API (Integration — Step 6.8a)", () => {
  describe("GET /api/students (Directory Search & Filtering)", () => {
    it("allows teacher and assistant to list students on tenant", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");
      const student1 = await createAndLoginStudent(t, "Ziad Mostafa", "+201111111111");

      const resTeacher = await as(t, teacher.cookie, "GET", "/students");
      expect(resTeacher.status).toBe(200);
      const bodyTeacher = resTeacher.body as {
        items: Array<{ membershipId: string; name: string }>;
      };
      expect(bodyTeacher.items.some((s) => s.membershipId === student1.membership.id)).toBe(true);

      const resAssistant = await as(t, assistant.cookie, "GET", "/students");
      expect(resAssistant.status).toBe(200);
    });

    it("filters students by search query q across name, email, and phone", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const uniquePrefix = randomUUID().slice(0, 6);
      const student1 = await createAndLoginStudent(
        t,
        `UniqueName_${uniquePrefix}`,
        "+201200000001",
      );
      const student2 = await createAndLoginStudent(t, "Normal Name", "+201200000002");

      // Search by unique name
      const resName = await as(t, teacher.cookie, "GET", `/students?q=${uniquePrefix}`);
      expect(resName.status).toBe(200);
      const bodyName = resName.body as { items: Array<{ membershipId: string }> };
      expect(bodyName.items).toHaveLength(1);
      expect(bodyName.items[0]?.membershipId).toBe(student1.membership.id);

      // Search by unique phone
      const resPhone = await as(t, teacher.cookie, "GET", `/students?q=00000002`);
      expect(resPhone.status).toBe(200);
      const bodyPhone = resPhone.body as { items: Array<{ membershipId: string }> };
      expect(bodyPhone.items).toHaveLength(1);
      expect(bodyPhone.items[0]?.membershipId).toBe(student2.membership.id);
    });

    it("filters students by membership status: active vs suspended", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const activeStudent = await createAndLoginStudent(t, "Active Student");
      const suspendedStudent = await createAndLoginStudent(t, "Suspended Student");

      // Suspend second student's membership
      await systemPrisma.membership.update({
        where: { id: suspendedStudent.membership.id },
        data: { status: "suspended" },
      });

      // Filter active
      const resActive = await as(t, teacher.cookie, "GET", "/students?status=active");
      expect(resActive.status).toBe(200);
      const bodyActive = resActive.body as { items: Array<{ membershipId: string }> };
      expect(bodyActive.items.some((s) => s.membershipId === activeStudent.membership.id)).toBe(
        true,
      );
      expect(bodyActive.items.some((s) => s.membershipId === suspendedStudent.membership.id)).toBe(
        false,
      );

      // Filter suspended
      const resSuspended = await as(t, teacher.cookie, "GET", "/students?status=suspended");
      expect(resSuspended.status).toBe(200);
      const bodySuspended = resSuspended.body as { items: Array<{ membershipId: string }> };
      expect(bodySuspended.items.some((s) => s.membershipId === activeStudent.membership.id)).toBe(
        false,
      );
      expect(
        bodySuspended.items.some((s) => s.membershipId === suspendedStudent.membership.id),
      ).toBe(true);
    });

    it("filters students by courseId", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const courseA = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course Alpha" },
      });
      const courseB = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course Beta" },
      });

      const studentA = await createAndLoginStudent(t, "Alpha Student");
      const studentB = await createAndLoginStudent(t, "Beta Student");

      // Enroll studentA in courseA
      await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: studentA.membership.id,
          courseId: courseA.id,
          status: "active",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      // Enroll studentB in courseB
      await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: studentB.membership.id,
          courseId: courseB.id,
          status: "active",
          source: "manual",
          grantedBy: teacher.user.id,
        },
      });

      // Query courseA students
      const resCourseA = await as(t, teacher.cookie, "GET", `/students?courseId=${courseA.id}`);
      expect(resCourseA.status).toBe(200);
      const bodyA = resCourseA.body as {
        items: Array<{ membershipId: string; enrolledCoursesCount: number }>;
      };
      expect(bodyA.items.some((s) => s.membershipId === studentA.membership.id)).toBe(true);
      expect(bodyA.items.some((s) => s.membershipId === studentB.membership.id)).toBe(false);
      expect(bodyA.items[0]?.enrolledCoursesCount).toBe(1);
    });

    it("supports cursor pagination", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      await createAndLoginStudent(t, "Page 1 Student");
      await createAndLoginStudent(t, "Page 2 Student");
      await createAndLoginStudent(t, "Page 3 Student");

      const page1 = await as(t, teacher.cookie, "GET", "/students?limit=2");
      expect(page1.status).toBe(200);
      const body1 = page1.body as {
        items: Array<{ membershipId: string }>;
        nextCursor: string | null;
      };
      expect(body1.items).toHaveLength(2);
      expect(body1.nextCursor).not.toBeNull();

      const page2 = await as(
        t,
        teacher.cookie,
        "GET",
        `/students?cursor=${body1.nextCursor}&limit=2`,
      );
      expect(page2.status).toBe(200);
      const body2 = page2.body as { items: Array<{ membershipId: string }> };
      expect(body2.items.length).toBeGreaterThanOrEqual(1);
      expect(body2.items.some((i) => i.membershipId === body1.items[0]?.membershipId)).toBe(false);
    });
  });

  describe("GET /api/students/:membershipId (Detail Aggregate)", () => {
    it("returns full detail aggregate (profile, courses, devices, sessions, grades, payments)", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const student = await createAndLoginStudent(t, "Full Detail Student", "+201099999999");

      // Bind a device to student
      const { device } = await fx.device(student.user.id, "active");

      // Open a session on this tenant
      const sess = await fx.session(student.user.id, device.id, t.id);

      // Create a course and enrollment
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Quantum Mechanics" },
      });
      await systemPrisma.enrollment.create({
        data: {
          tenantId: t.id,
          membershipId: student.membership.id,
          courseId: course.id,
          status: "active",
          source: "code",
          grantedBy: teacher.user.id,
        },
      });

      const res = await as(t, teacher.cookie, "GET", `/students/${student.membership.id}`);
      expect(res.status).toBe(200);
      const body = res.body as {
        profile: {
          membershipId: string;
          userId: string;
          name: string;
          email: string;
          phone: string;
          status: string;
          maxDevices: number;
        };
        courses: Array<{ title: string; status: string; source: string }>;
        devices: Array<{ status: string }>;
        sessions: Array<{ id: string }>;
        grades: unknown[];
        payments: unknown[];
      };

      expect(body.profile.membershipId).toBe(student.membership.id);
      expect(body.profile.name).toBe("Full Detail Student");
      expect(body.profile.phone).toBe("+201099999999");
      expect(body.profile.status).toBe("active");
      expect(body.profile.maxDevices).toBe(1);

      expect(body.courses).toHaveLength(1);
      expect(body.courses[0]?.title).toBe("Quantum Mechanics");
      expect(body.courses[0]?.status).toBe("active");
      expect(body.courses[0]?.source).toBe("code");

      expect(body.devices.length).toBeGreaterThanOrEqual(1);
      expect(body.sessions.some((s) => s.id === sess.id)).toBe(true);
      expect(body.grades).toEqual([]);
      expect(body.payments).toEqual([]);
    });
  });

  describe("Isolation & Security", () => {
    it("returns 404 when querying a student belonging to another tenant (Tenant Isolation)", async () => {
      const tenantA = await fx.tenant();
      const tenantB = await fx.tenant();
      const teacherA = await fx.staffLogin(tenantA, "teacher");
      const studentB = await createAndLoginStudent(tenantB, "Tenant B Student");

      // Teacher A queries Student B on Tenant A's host
      const res = await as(tenantA, teacherA.cookie, "GET", `/students/${studentB.membership.id}`);
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("STUDENT_NOT_FOUND");
    });

    it("returns 404 when querying a staff membership on /students/:id", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const { membership: assistantMem } = await fx.member(t.id, "assistant");

      const res = await as(t, teacher.cookie, "GET", `/students/${assistantMem.id}`);
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("STUDENT_NOT_FOUND");
    });

    it("rejects student caller attempting to list or view students with 403 ROLE_FORBIDDEN", async () => {
      const t = await fx.tenant();
      const student1 = await createAndLoginStudent(t, "Student One");
      const student2 = await createAndLoginStudent(t, "Student Two");

      // Student tries GET /students
      const listRes = await as(t, student1.cookie, "GET", "/students");
      expect(listRes.status).toBe(403);

      // Student tries GET /students/:id
      const detailRes = await as(t, student1.cookie, "GET", `/students/${student2.membership.id}`);
      expect(detailRes.status).toBe(403);
    });

    it("rejects unauthenticated request with 401", async () => {
      const t = await fx.tenant();
      const listRes = await anon(t, "GET", "/students");
      expect(listRes.status).toBe(401);

      const detailRes = await anon(t, "GET", `/students/${randomUUID()}`);
      expect(detailRes.status).toBe(401);
    });
  });
});
