import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "SuperAdminPassword123!";
const fx = studentFixtures(PASSWORD);
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await systemPrisma.tenant.deleteMany({
    where: { slug: { startsWith: "alpha-" } },
  });
  await systemPrisma.tenant.deleteMany({
    where: { slug: { startsWith: "beta-" } },
  });
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

const asAdmin = (cookie: string, method: string, path: string, body?: unknown) =>
  http.send("admin.localhost", method, `/api${path}`, body, { cookie });
const anon = (host: string, method: string, path: string, body?: unknown) =>
  http.send(host, method, `/api${path}`, body);

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;

describe("Super Admin Tenant API (Integration — Step 6.11a)", () => {
  describe("POST /api/admin/tenants (Creation & Instant Host Resolution)", () => {
    it("allows super admin to create a tenant and resolves its host immediately over HTTP (Done Condition)", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const slug = `alpha-${randomUUID().slice(0, 6)}`;
      const teacherEmail = `teacher-${randomUUID().slice(0, 8)}@example.com`;

      const res = await asAdmin(admin.cookie, "POST", "/admin/tenants", {
        name: "Alpha Physics Academy",
        slug,
        teacherEmail,
        teacherName: "Ustaz Alpha",
        temporaryPassword: "AlphaPassword123!",
      });

      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        slug: string;
        name: string;
        status: string;
        teacher: { name: string; email: string };
        usage: { studentCount: number; courseCount: number; storageBytes: number };
        existingUserLinked: boolean;
      };

      expect(body.slug).toBe(slug);
      expect(body.name).toBe("Alpha Physics Academy");
      expect(body.status).toBe("active");
      expect(body.teacher.email).toBe(teacherEmail);
      expect(body.teacher.name).toBe("Ustaz Alpha");
      expect(body.usage).toEqual({ studentCount: 0, courseCount: 0, storageBytes: 0 });
      expect(body.existingUserLinked).toBe(false);

      // Verify audit log
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          action: "tenant.create",
          targetId: body.id,
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(admin.user.id);

      // Done condition: Send HTTP request to the newly created tenant's host
      // and verify that the hostname resolves cleanly through TenantMiddleware
      const hostProbe = await http.send(`${slug}.localhost`, "GET", "/api/health");
      expect(hostProbe.status).toBe(200);

      // Clean up created tenant
      await systemPrisma.tenant.deleteMany({ where: { slug } });
      await systemPrisma.user.deleteMany({ where: { email: teacherEmail } });
    });

    it("links an existing global user as primary teacher without altering credentials", async () => {
      const tA = await fx.tenant();
      const admin = await fx.staffLogin(tA, "teacher", { superAdmin: true });

      // User exists on Tenant A as student
      const { user } = await fx.member(tA.id, "student");

      const slug = `beta-${randomUUID().slice(0, 6)}`;
      const res = await asAdmin(admin.cookie, "POST", "/admin/tenants", {
        name: "Beta Academy",
        slug,
        teacherEmail: user.email,
        temporaryPassword: "IrrelevantPassword999!",
      });

      expect(res.status).toBe(201);
      const body = res.body as { existingUserLinked: boolean; teacher: { id: string } };
      expect(body.existingUserLinked).toBe(true);
      expect(body.teacher.id).toBe(user.id);

      // Verify user's existing student membership on Tenant A remains intact
      const memberA = await systemPrisma.membership.findFirst({
        where: { tenantId: tA.id, userId: user.id },
      });
      expect(memberA?.role).toBe("student");

      // Verify user has teacher membership on the new tenant
      const memberB = await systemPrisma.membership.findFirst({
        where: { tenant: { slug }, userId: user.id },
      });
      expect(memberB?.role).toBe("teacher");

      // Clean up
      await systemPrisma.tenant.deleteMany({ where: { slug } });
    });

    it("rejects duplicate slug with 409 SLUG_ALREADY_EXISTS", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const res = await asAdmin(admin.cookie, "POST", "/admin/tenants", {
        name: "Duplicate Academy",
        slug: t.slug,
        teacherEmail: "new-teacher@example.com",
        temporaryPassword: "Password123!",
      });

      expect(res.status).toBe(409);
      expect((res.body as { code?: string }).code).toBe("SLUG_ALREADY_EXISTS");
    });

    it("rejects reserved subdomains with 400 INVALID_BODY", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      for (const reserved of ["admin", "api", "app", "www", "localhost", "support"]) {
        const res = await asAdmin(admin.cookie, "POST", "/admin/tenants", {
          name: "Reserved Tenant",
          slug: reserved,
          teacherEmail: "teacher@example.com",
          temporaryPassword: "Password123!",
        });
        expect(res.status).toBe(400);
        expect(reasonOf(res.body)).toBe("INVALID_BODY");
      }
    });

    it("rejects invalid slug format with 400", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      for (const badSlug of ["-leading", "trailing-", "UPPERCASE", "ab", "a--b"]) {
        const res = await asAdmin(admin.cookie, "POST", "/admin/tenants", {
          name: "Bad Slug Tenant",
          slug: badSlug,
          teacherEmail: "teacher@example.com",
          temporaryPassword: "Password123!",
        });
        expect(res.status).toBe(400);
      }
    });
  });

  describe("GET /api/admin/tenants (Listing & Usage Metrics — FR-T05)", () => {
    it("lists tenants with accurate live usage: students, published courses, and storage", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      // Create students on t: 2 active, 1 suspended
      await fx.member(t.id, "student");
      await fx.member(t.id, "student");
      const s3 = await fx.member(t.id, "student");
      await systemPrisma.membership.update({
        where: { id: s3.membership.id },
        data: { status: "suspended" },
      });

      // Create courses on t: 2 published, 1 draft
      await systemPrisma.course.createMany({
        data: [
          { tenantId: t.id, title: "Course Pub 1", status: "published" },
          { tenantId: t.id, title: "Course Pub 2", status: "published" },
          { tenantId: t.id, title: "Course Draft 1", status: "draft" },
        ],
      });

      const res = await asAdmin(admin.cookie, "GET", "/admin/tenants");
      expect(res.status).toBe(200);

      const body = res.body as {
        items: Array<{
          id: string;
          slug: string;
          usage: { studentCount: number; courseCount: number; storageBytes: number };
        }>;
        nextCursor: unknown;
      };

      const found = body.items.find((item) => item.id === t.id);
      expect(found).toBeDefined();
      expect(found?.usage.studentCount).toBe(2);
      expect(found?.usage.courseCount).toBe(2);
      expect(found?.usage.storageBytes).toBe(0);
    });

    it("supports cursor pagination", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const page1 = await asAdmin(admin.cookie, "GET", "/admin/tenants?limit=1");
      expect(page1.status).toBe(200);
      const b1 = page1.body as { items: Array<{ id: string }>; nextCursor: string };
      expect(b1.items).toHaveLength(1);
      expect(b1.nextCursor).toBeTruthy();

      const page2 = await asAdmin(
        admin.cookie,
        "GET",
        `/admin/tenants?limit=1&cursor=${b1.nextCursor}`,
      );
      expect(page2.status).toBe(200);
      const b2 = page2.body as { items: Array<{ id: string }> };
      expect(b2.items).toHaveLength(1);
      expect(b2.items[0]!.id).not.toBe(b1.items[0]!.id);
    });
  });

  describe("GET /api/admin/tenants/:id (Single Tenant Detail)", () => {
    it("returns single tenant details with live usage", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const res = await asAdmin(admin.cookie, "GET", `/admin/tenants/${t.id}`);
      expect(res.status).toBe(200);

      const body = res.body as {
        id: string;
        slug: string;
        name: string;
        usage: { studentCount: number; courseCount: number; storageBytes: number };
      };
      expect(body.id).toBe(t.id);
      expect(body.slug).toBe(t.slug);
      expect(body.usage).toBeDefined();
    });

    it("returns 404 for non-existent tenant ID", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const res = await asAdmin(admin.cookie, "GET", `/admin/tenants/${randomUUID()}`);
      expect(res.status).toBe(404);
      expect((res.body as { code?: string }).code).toBe("TENANT_NOT_FOUND");
    });
  });

  describe("Role Barriers & Authorization", () => {
    it("rejects non-super-admin staff and students with 403 NO_ACCESS", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");
      const student = await fx.member(t.id, "student");
      const studentLogin = await fx.studentLogin(t, student.user.email);

      // Teacher
      const tPost = await asAdmin(teacher.cookie, "POST", "/admin/tenants", {});
      expect(tPost.status).toBe(403);
      const tGet = await asAdmin(teacher.cookie, "GET", "/admin/tenants");
      expect(tGet.status).toBe(403);

      // Assistant
      const aPost = await asAdmin(assistant.cookie, "POST", "/admin/tenants", {});
      expect(aPost.status).toBe(403);

      // Student
      const sGet = await asAdmin(studentLogin.cookies, "GET", "/admin/tenants");
      expect(sGet.status).toBe(403);
    });

    it("rejects unauthenticated requests with 401", async () => {
      expect((await anon("admin.localhost", "GET", "/admin/tenants")).status).toBe(401);
      expect((await anon("admin.localhost", "POST", "/admin/tenants", {})).status).toBe(401);
      expect((await anon("admin.localhost", "GET", `/admin/tenants/${randomUUID()}`)).status).toBe(
        401,
      );
    });

    it("allows super admin to call /api/admin/tenants from a tenant host", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const res = await http.send(`${t.slug}.localhost`, "GET", "/api/admin/tenants", undefined, {
        cookie: admin.cookie,
      });
      expect(res.status).toBe(200);
    });
  });
});
