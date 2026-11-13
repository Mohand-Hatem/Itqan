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
  await systemPrisma.auditLog.deleteMany({
    where: {
      action: { in: ["tenant.update", "tenant.delete", "user.suspend", "user.reactivate"] },
    },
  });
  await systemPrisma.tenant.deleteMany({
    where: { slug: { startsWith: "lifecycle-" } },
  });
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

const asAdmin = (cookie: string, method: string, path: string, body?: unknown) =>
  http.send("admin.localhost", method, `/api${path}`, body, { cookie });
const anon = (host: string, method: string, path: string, body?: unknown) =>
  http.send(host, method, `/api${path}`, body);

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;

describe("Super Admin Lifecycle & Access Control API (Step 6.12a — FR-T03, FR-T04)", () => {
  describe("Role Pausing (PATCH /api/admin/tenants/:id — FR-T03)", () => {
    it("pauses student role, evicts student sessions immediately, while teacher session still works (Done Condition)", async () => {
      // 1. Create tenant with teacher and student
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });
      const teacher = await fx.staffLogin(t, "teacher");
      const { user: studentUser } = await fx.member(t.id, "student");

      const studentSignIn = await fx.studentLogin(t, studentUser.email);
      expect(studentSignIn.status).toBe(200);

      // Verify both sessions work before pause
      const teacherPre = await http.send(`${t.slug}.localhost`, "GET", "/api/me", undefined, {
        cookie: teacher.cookie,
      });
      expect(teacherPre.status).toBe(200);

      const studentPre = await http.send(`${t.slug}.localhost`, "GET", "/api/me", undefined, {
        cookie: studentSignIn.cookies,
      });
      expect(studentPre.status).toBe(200);

      // 2. Super admin pauses student role
      const patchRes = await asAdmin(admin.cookie, "PATCH", `/admin/tenants/${t.id}`, {
        pausedRoles: ["student"],
      });
      expect(patchRes.status).toBe(200);
      const patchBody = patchRes.body as { pausedRoles: string[] };
      expect(patchBody.pausedRoles).toEqual(["student"]);

      // 3. Verify student session is evicted (Done Condition)
      const studentPost = await http.send(`${t.slug}.localhost`, "GET", "/api/me", undefined, {
        cookie: studentSignIn.cookies,
      });
      // Session deleted in DB -> 401 Unauthorized
      expect(studentPost.status).toBe(401);

      // Subsequent login attempt by student is blocked with 403 TENANT_PAUSED
      const studentRetryLogin = await fx.studentLogin(t, studentUser.email);
      expect(studentRetryLogin.status).toBe(403);
      expect(studentRetryLogin.code).toBe("TENANT_PAUSED");

      // 4. Verify teacher session is completely unaffected and still works (Done Condition)
      const teacherPost = await http.send(`${t.slug}.localhost`, "GET", "/api/me", undefined, {
        cookie: teacher.cookie,
      });
      expect(teacherPost.status).toBe(200);

      // Verify audit log
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: t.id,
          action: "tenant.update",
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(admin.user.id);
    });

    it("unpauses student role, restores login access without altering data", async () => {
      const t = await fx.tenant(["student"]);
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });
      const { user: studentUser } = await fx.member(t.id, "student");

      // Verify student login initially blocked
      const blockedLogin = await fx.studentLogin(t, studentUser.email);
      expect(blockedLogin.status).toBe(403);

      // Super admin unpauses all roles
      const unpauseRes = await asAdmin(admin.cookie, "PATCH", `/admin/tenants/${t.id}`, {
        pausedRoles: [],
      });
      expect(unpauseRes.status).toBe(200);
      expect((unpauseRes.body as { pausedRoles: string[] }).pausedRoles).toEqual([]);

      // Student can sign in successfully now
      const allowedLogin = await fx.studentLogin(t, studentUser.email);
      expect(allowedLogin.status).toBe(200);
    });

    it("updates tenant name and slug, invalidates old slug, and warms new slug in cache", async () => {
      const initialSlug = `lifecycle-${randomUUID().slice(0, 6)}`;
      const newSlug = `lifecycle-${randomUUID().slice(0, 6)}`;

      const t = await systemPrisma.tenant.create({
        data: {
          name: "Original Name",
          slug: initialSlug,
          status: "active",
        },
      });
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      // Warm original slug in cache
      const oldProbe = await http.send(`${initialSlug}.localhost`, "GET", "/api/me");
      expect(oldProbe.status).toBe(401);

      // Update slug & name
      const updateRes = await asAdmin(admin.cookie, "PATCH", `/admin/tenants/${t.id}`, {
        name: "Renamed Academy",
        slug: newSlug,
      });
      expect(updateRes.status).toBe(200);
      const updateBody = updateRes.body as { name: string; slug: string };
      expect(updateBody.name).toBe("Renamed Academy");
      expect(updateBody.slug).toBe(newSlug);

      // Old slug must return 404 immediately
      const oldProbeAfter = await http.send(`${initialSlug}.localhost`, "GET", "/api/me");
      expect(oldProbeAfter.status).toBe(404);

      // New slug must resolve 401 (valid tenant) immediately
      const newProbeAfter = await http.send(`${newSlug}.localhost`, "GET", "/api/me");
      expect(newProbeAfter.status).toBe(401);
    });
  });

  describe("Soft Deletion (DELETE /api/admin/tenants/:id — FR-T04)", () => {
    it("soft-deletes tenant, terminates all tenant sessions, and disables subdomain resolution to 404 (Done Condition)", async () => {
      const slug = `lifecycle-${randomUUID().slice(0, 6)}`;
      const t = await systemPrisma.tenant.create({
        data: {
          name: "Academy To Delete",
          slug,
          status: "active",
        },
      });

      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });
      const teacher = await fx.staffLogin(t, "teacher");
      const { user: studentUser } = await fx.member(t.id, "student");
      const studentSignIn = await fx.studentLogin(t, studentUser.email);

      // Confirm host resolves
      const hostCheck = await http.send(`${slug}.localhost`, "GET", "/api/health");
      expect(hostCheck.status).toBe(200);

      // Confirm sessions work
      expect(
        (
          await http.send(`${slug}.localhost`, "GET", "/api/me", undefined, {
            cookie: teacher.cookie,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await http.send(`${slug}.localhost`, "GET", "/api/me", undefined, {
            cookie: studentSignIn.cookies,
          })
        ).status,
      ).toBe(200);

      // Soft delete tenant
      const delRes = await asAdmin(admin.cookie, "DELETE", `/admin/tenants/${t.id}`);
      expect(delRes.status).toBe(200);
      const delBody = delRes.body as {
        id: string;
        status: string;
        deletedAt: string;
        sessionsEvicted: number;
      };
      expect(delBody.id).toBe(t.id);
      expect(delBody.status).toBe("deleted");
      expect(delBody.deletedAt).toBeDefined();
      expect(delBody.sessionsEvicted).toBeGreaterThanOrEqual(2);

      // DB verification
      const dbTenant = await systemPrisma.tenant.findUnique({ where: { id: t.id } });
      expect(dbTenant?.status).toBe("deleted");
      expect(dbTenant?.deletedAt).not.toBeNull();

      const remainingSessions = await systemPrisma.session.findMany({
        where: { tenantId: t.id },
      });
      expect(remainingSessions).toHaveLength(0);

      // Done condition verification: subdomain immediately returns 404 TENANT_NOT_FOUND
      const hostProbe = await http.send(`${slug}.localhost`, "GET", "/api/me");
      expect(hostProbe.status).toBe(404);

      // Subsequent delete returns 404
      const secondDel = await asAdmin(admin.cookie, "DELETE", `/admin/tenants/${t.id}`);
      expect(secondDel.status).toBe(404);
    });
  });

  describe("User Suspension (PATCH /api/admin/users/:id — FR-T03)", () => {
    it("suspends a user, terminates all sessions globally, and returns 403 USER_SUSPENDED on subsequent requests", async () => {
      const t1 = await fx.tenant();
      const t2 = await fx.tenant();
      const admin = await fx.staffLogin(t1, "teacher", { superAdmin: true });

      // User has student membership on t1 and t2
      const u = await fx.user();
      await systemPrisma.membership.createMany({
        data: [
          { tenantId: t1.id, userId: u.id, role: "student", status: "active" },
          { tenantId: t2.id, userId: u.id, role: "student", status: "active" },
        ],
      });

      const s1 = await fx.studentLogin(t1, u.email);
      const s2 = await fx.studentLogin(t2, u.email, s1.cookies);
      expect(s1.status).toBe(200);
      expect(s2.status).toBe(200);

      // Verify sessions active on both tenants
      expect(
        (
          await http.send(`${t1.slug}.localhost`, "GET", "/api/me", undefined, {
            cookie: s1.cookies,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await http.send(`${t2.slug}.localhost`, "GET", "/api/me", undefined, {
            cookie: s2.cookies,
          })
        ).status,
      ).toBe(200);

      // Super admin suspends user globally
      const suspendRes = await asAdmin(admin.cookie, "PATCH", `/admin/users/${u.id}`, {
        status: "suspended",
      });
      expect(suspendRes.status).toBe(200);
      const suspendBody = suspendRes.body as {
        id: string;
        status: string;
        sessionsEvicted: number;
      };
      expect(suspendBody.status).toBe("suspended");
      expect(suspendBody.sessionsEvicted).toBeGreaterThanOrEqual(2);

      // DB check: user status is suspended, sessions deleted
      const dbUser = await systemPrisma.user.findUnique({ where: { id: u.id } });
      expect(dbUser?.status).toBe("suspended");

      const userSessions = await systemPrisma.session.findMany({ where: { userId: u.id } });
      expect(userSessions).toHaveLength(0);

      // Subsequent login attempt is blocked with 403 USER_SUSPENDED
      const retryLogin = await fx.studentLogin(t1, u.email);
      expect(retryLogin.status).toBe(403);
      expect(retryLogin.code).toBe("USER_SUSPENDED");

      // Reactivate user
      const reactivateRes = await asAdmin(admin.cookie, "PATCH", `/admin/users/${u.id}`, {
        status: "active",
      });
      expect(reactivateRes.status).toBe(200);
      expect((reactivateRes.body as { status: string }).status).toBe("active");

      // User can sign in again from their device
      const restoredLogin = await fx.studentLogin(t1, u.email, s1.cookies);
      expect(restoredLogin.status).toBe(200);
    });

    it("blocks super admin from suspending their own account (Self-Suspension Guard)", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const selfSuspend = await asAdmin(admin.cookie, "PATCH", `/admin/users/${admin.user.id}`, {
        status: "suspended",
      });
      expect(selfSuspend.status).toBe(400);
      expect(reasonOf(selfSuspend.body)).toBe("CANNOT_SUSPEND_SELF");

      // Verify admin remains active
      const dbAdmin = await systemPrisma.user.findUnique({ where: { id: admin.user.id } });
      expect(dbAdmin?.status).toBe("active");
    });
  });

  describe("Role Barriers & Authorization", () => {
    it("rejects non-super-admin staff and students with 403 NO_ACCESS", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");
      const { user: studentUser } = await fx.member(t.id, "student");
      const studentLogin = await fx.studentLogin(t, studentUser.email);

      // Teacher attempting PATCH tenant
      const tPatch = await asAdmin(teacher.cookie, "PATCH", `/admin/tenants/${t.id}`, {
        pausedRoles: ["student"],
      });
      expect(tPatch.status).toBe(403);

      // Assistant attempting DELETE tenant
      const aDel = await asAdmin(assistant.cookie, "DELETE", `/admin/tenants/${t.id}`);
      expect(aDel.status).toBe(403);

      // Student attempting PATCH user
      const sPatch = await asAdmin(
        studentLogin.cookies,
        "PATCH",
        `/admin/users/${studentUser.id}`,
        {
          status: "suspended",
        },
      );
      expect(sPatch.status).toBe(403);
    });

    it("rejects unauthenticated requests with 401", async () => {
      const randomId = randomUUID();
      expect(
        (await anon("admin.localhost", "PATCH", `/admin/tenants/${randomId}`, {})).status,
      ).toBe(401);
      expect((await anon("admin.localhost", "DELETE", `/admin/tenants/${randomId}`)).status).toBe(
        401,
      );
      expect((await anon("admin.localhost", "PATCH", `/admin/users/${randomId}`, {})).status).toBe(
        401,
      );
    });
  });
});
