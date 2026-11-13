import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "CourseTestPassword123!";
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
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const auditOf = (tenantId: string, targetId: string) =>
  systemPrisma.auditLog.findMany({ where: { tenantId, targetId } });

describe("Courses API", () => {
  describe("POST /api/courses", () => {
    it("teacher and assistant can create a course in draft status with audit logging", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");

      // Teacher creates
      const res1 = await as(t, teacher.cookie, "POST", "/courses", {
        title: "Introduction to Biology",
        description: "Foundational concepts in biology",
      });
      expect(res1.status).toBe(201);
      expect(res1.body).toMatchObject({
        title: "Introduction to Biology",
        description: "Foundational concepts in biology",
        status: "draft",
        deletedAt: null,
      });
      const course1Id = (res1.body as { id: string }).id;

      const [audit1] = await auditOf(t.id, course1Id);
      expect(audit1).toMatchObject({
        action: "course.create",
        actorUserId: teacher.user.id,
        targetType: "course",
      });

      // Assistant creates
      const res2 = await as(t, assistant.cookie, "POST", "/courses", {
        title: "Advanced Chemistry",
      });
      expect(res2.status).toBe(201);
      expect(res2.body).toMatchObject({
        title: "Advanced Chemistry",
        status: "draft",
      });
    });

    it("rejects invalid payloads with 400 INVALID_BODY", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const res = await as(t, teacher.cookie, "POST", "/courses", {
        title: "   ",
      });
      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("INVALID_BODY");
    });

    it("students receive 403 ROLE_FORBIDDEN", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const student = await fx.studentLogin(t, user.email);

      const res = await as(t, student.cookies, "POST", "/courses", {
        title: "Student Trying to Create",
      });
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    });
  });

  describe("GET /api/courses & pagination / filters", () => {
    it("lists courses with cursor pagination and status filtering, excluding soft-deleted", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      // Create 3 courses
      const c1 = await as(t, teacher.cookie, "POST", "/courses", { title: "Course 1" });
      const c2 = await as(t, teacher.cookie, "POST", "/courses", { title: "Course 2" });
      const c3 = await as(t, teacher.cookie, "POST", "/courses", { title: "Course 3" });

      const c1Id = (c1.body as { id: string }).id;
      const c2Id = (c2.body as { id: string }).id;
      const c3Id = (c3.body as { id: string }).id;

      // Publish course 2
      await as(t, teacher.cookie, "PATCH", `/courses/${c2Id}`, { status: "published" });
      // Soft-delete course 1
      await as(t, teacher.cookie, "DELETE", `/courses/${c1Id}`);

      // List all: should return c3 (draft) and c2 (published), but not c1 (deleted)
      const listAll = await as(t, teacher.cookie, "GET", "/courses");
      expect(listAll.status).toBe(200);
      const itemsAll = (listAll.body as { items: Array<{ id: string }> }).items;
      expect(itemsAll.map((i) => i.id)).toEqual([c3Id, c2Id]);

      // Filter by status=published
      const listPublished = await as(t, teacher.cookie, "GET", "/courses?status=published");
      expect(listPublished.status).toBe(200);
      const itemsPublished = (listPublished.body as { items: Array<{ id: string }> }).items;
      expect(itemsPublished.map((i) => i.id)).toEqual([c2Id]);

      // Pagination with limit=1
      const page1 = await as(t, teacher.cookie, "GET", "/courses?limit=1");
      expect(page1.status).toBe(200);
      const p1Body = page1.body as { items: Array<{ id: string }>; nextCursor: string | null };
      expect(p1Body.items.map((i) => i.id)).toEqual([c3Id]);
      expect(p1Body.nextCursor).toBe(c3Id);

      // Page 2
      const page2 = await as(
        t,
        teacher.cookie,
        "GET",
        `/courses?limit=1&cursor=${p1Body.nextCursor}`,
      );
      expect(page2.status).toBe(200);
      const p2Body = page2.body as { items: Array<{ id: string }>; nextCursor: string | null };
      expect(p2Body.items.map((i) => i.id)).toEqual([c2Id]);
      expect(p2Body.nextCursor).toBeNull();
    });

    it("students receive 403 ROLE_FORBIDDEN in step 6.1", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const student = await fx.studentLogin(t, user.email);

      const res = await as(t, student.cookies, "GET", "/courses");
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    });
  });

  describe("GET /api/courses/:id", () => {
    it("returns course details for staff, 404 if deleted or other tenant", async () => {
      const t1 = await fx.tenant();
      const t2 = await fx.tenant();
      const teacher1 = await fx.staffLogin(t1, "teacher");
      const teacher2 = await fx.staffLogin(t2, "teacher");

      const created = await as(t1, teacher1.cookie, "POST", "/courses", { title: "T1 Course" });
      const id = (created.body as { id: string }).id;

      // Same tenant teacher succeeds
      const getOwn = await as(t1, teacher1.cookie, "GET", `/courses/${id}`);
      expect(getOwn.status).toBe(200);
      expect(getOwn.body).toMatchObject({ id, title: "T1 Course" });

      // Cross-tenant gets 404
      const getCross = await as(t2, teacher2.cookie, "GET", `/courses/${id}`);
      expect(getCross.status).toBe(404);

      // Soft-delete and verify 404
      await as(t1, teacher1.cookie, "DELETE", `/courses/${id}`);
      const getDeleted = await as(t1, teacher1.cookie, "GET", `/courses/${id}`);
      expect(getDeleted.status).toBe(404);
    });
  });

  describe("PATCH /api/courses/:id", () => {
    it("updates course fields and status with audit logging", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");

      const created = await as(t, teacher.cookie, "POST", "/courses", {
        title: "Original Title",
        description: "Original Description",
      });
      const id = (created.body as { id: string }).id;

      // Assistant can update
      const res = await as(t, assistant.cookie, "PATCH", `/courses/${id}`, {
        title: "Updated Title",
        status: "published",
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        title: "Updated Title",
        status: "published",
        description: "Original Description",
      });

      const audits = await auditOf(t.id, id);
      const updateAudit = audits.find((a) => a.action === "course.update");
      expect(updateAudit).toMatchObject({
        actorUserId: assistant.user.id,
        targetType: "course",
      });
    });
  });

  describe("DELETE /api/courses/:id", () => {
    it("teacher can soft-delete, assistant and student receive 403", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");
      const { user } = await fx.member(t.id, "student");
      const student = await fx.studentLogin(t, user.email);

      const created = await as(t, teacher.cookie, "POST", "/courses", { title: "To Delete" });
      const id = (created.body as { id: string }).id;

      // Student gets 403
      const studentRes = await as(t, student.cookies, "DELETE", `/courses/${id}`);
      expect(studentRes.status).toBe(403);
      expect(reasonOf(studentRes.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      // Assistant gets 403
      const assistantRes = await as(t, assistant.cookie, "DELETE", `/courses/${id}`);
      expect(assistantRes.status).toBe(403);
      expect(reasonOf(assistantRes.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      // Teacher succeeds
      const teacherRes = await as(t, teacher.cookie, "DELETE", `/courses/${id}`);
      expect(teacherRes.status).toBe(200);
      expect(teacherRes.body).toMatchObject({ id, deleted: true });

      // Verify soft delete in db
      const dbCourse = await systemPrisma.course.findUniqueOrThrow({ where: { id } });
      expect(dbCourse.deletedAt).not.toBeNull();

      // Audit log exists
      const audits = await auditOf(t.id, id);
      const deleteAudit = audits.find((a) => a.action === "course.delete");
      expect(deleteAudit).toMatchObject({
        actorUserId: teacher.user.id,
        targetType: "course",
      });
    });
  });
});
