import { randomUUID } from "node:crypto";
import { auth } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "AssistantMasterPassword123!";
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

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;

async function staffSignIn(email: string, password: string) {
  const res = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .join("; ");
  return { cookie };
}

describe("Assistant Management API (Integration — Step 6.10a)", () => {
  describe("POST /api/assistants (Provisioning)", () => {
    it("allows teacher to provision a new assistant with temporary password", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const email = `assistant-${randomUUID().slice(0, 8)}@example.com`;
      const tempPass = "TempPass1234!";

      const res = await as(t, teacher.cookie, "POST", "/assistants", {
        name: "Omar Assistant",
        email,
        temporaryPassword: tempPass,
      });

      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        userId: string;
        name: string;
        email: string;
        role: string;
        existingUserLinked: boolean;
      };
      expect(body.name).toBe("Omar Assistant");
      expect(body.email).toBe(email);
      expect(body.role).toBe("assistant");
      expect(body.existingUserLinked).toBe(false);

      // Verify membership was created in DB
      const member = await systemPrisma.membership.findUnique({
        where: { id: body.id },
      });
      expect(member).not.toBeNull();
      expect(member?.role).toBe("assistant");
      expect(member?.tenantId).toBe(t.id);

      // Verify audit log
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: t.id,
          action: "assistant.create",
          targetId: body.id,
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(teacher.user.id);

      // Verify the new assistant can log in with temporary credentials
      const loginRes = await staffSignIn(email, tempPass);
      expect(loginRes.cookie).toContain("better-auth.session_token");
    });

    it("links an existing global user as assistant without overwriting their password", async () => {
      const tA = await fx.tenant();
      const tB = await fx.tenant();
      const teacherA = await fx.staffLogin(tA, "teacher");

      // User exists on Tenant B with PASSWORD
      const { user } = await fx.member(tB.id, "student");

      const res = await as(tA, teacherA.cookie, "POST", "/assistants", {
        name: user.name,
        email: user.email,
        temporaryPassword: "DifferentTempPass999!",
      });

      expect(res.status).toBe(201);
      const body = res.body as { existingUserLinked: boolean; userId: string; role: string };
      expect(body.existingUserLinked).toBe(true);
      expect(body.userId).toBe(user.id);
      expect(body.role).toBe("assistant");

      // Verify original password is still intact and works
      const loginRes = await staffSignIn(user.email, PASSWORD);
      expect(loginRes.cookie).toContain("better-auth.session_token");
    });

    it("rejects duplicate assistant creation for a user already in tenant with 409", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const email = `dupe-${randomUUID().slice(0, 8)}@example.com`;
      await as(t, teacher.cookie, "POST", "/assistants", {
        name: "Dupe Assistant",
        email,
        temporaryPassword: "TempPass1234!",
      });

      const dupeRes = await as(t, teacher.cookie, "POST", "/assistants", {
        name: "Dupe Assistant Again",
        email,
        temporaryPassword: "TempPass1234!",
      });

      expect(dupeRes.status).toBe(409);
      expect((dupeRes.body as { code?: string }).code).toBe("MEMBERSHIP_ALREADY_EXISTS");
    });

    it("rejects invalid payload with 400", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const res = await as(t, teacher.cookie, "POST", "/assistants", {
        name: "A",
        email: "not-an-email",
        temporaryPassword: "short",
      });

      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("INVALID_BODY");
    });
  });

  describe("GET /api/assistants (Listing)", () => {
    it("allows teacher to list all assistants on the tenant", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const a1 = await as(t, teacher.cookie, "POST", "/assistants", {
        name: "Assistant One",
        email: `a1-${randomUUID().slice(0, 8)}@example.com`,
        temporaryPassword: "TempPassword123!",
      });
      const a2 = await as(t, teacher.cookie, "POST", "/assistants", {
        name: "Assistant Two",
        email: `a2-${randomUUID().slice(0, 8)}@example.com`,
        temporaryPassword: "TempPassword123!",
      });

      const listRes = await as(t, teacher.cookie, "GET", "/assistants");
      expect(listRes.status).toBe(200);

      const body = listRes.body as {
        items: Array<{ id: string; name: string }>;
        nextCursor: unknown;
      };
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      const ids = body.items.map((i) => i.id);
      expect(ids).toContain((a1.body as { id: string }).id);
      expect(ids).toContain((a2.body as { id: string }).id);
    });

    it("supports cursor pagination", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      for (let i = 0; i < 3; i++) {
        await as(t, teacher.cookie, "POST", "/assistants", {
          name: `Pagination Assistant ${i}`,
          email: `pag-${i}-${randomUUID().slice(0, 8)}@example.com`,
          temporaryPassword: "TempPassword123!",
        });
      }

      const page1 = await as(t, teacher.cookie, "GET", "/assistants?limit=2");
      expect(page1.status).toBe(200);
      const b1 = page1.body as { items: Array<{ id: string }>; nextCursor: string };
      expect(b1.items).toHaveLength(2);
      expect(b1.nextCursor).toBeTruthy();

      const page2 = await as(
        t,
        teacher.cookie,
        "GET",
        `/assistants?limit=2&cursor=${b1.nextCursor}`,
      );
      expect(page2.status).toBe(200);
      const b2 = page2.body as { items: Array<{ id: string }> };
      expect(b2.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("DELETE /api/assistants/:id (Removal & Immediate Invalidation)", () => {
    it("deletes assistant membership and transactionally evicts tenant sessions", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const email = `to-delete-${randomUUID().slice(0, 8)}@example.com`;
      const tempPass = "TempPassword123!";

      const created = await as(t, teacher.cookie, "POST", "/assistants", {
        name: "Soon Deleted",
        email,
        temporaryPassword: tempPass,
      });
      const assistantId = (created.body as { id: string }).id;

      // Assistant logs in and gets a session
      const loginRes = await staffSignIn(email, tempPass);
      const assistantCookie = loginRes.cookie;

      // Verify assistant can call /api/me
      const meBefore = await http.send(host(t), "GET", "/api/me", undefined, {
        cookie: assistantCookie,
      });
      expect(meBefore.status).toBe(200);

      // Teacher deletes the assistant
      const delRes = await as(t, teacher.cookie, "DELETE", `/assistants/${assistantId}`);
      expect(delRes.status).toBe(200);
      const delBody = delRes.body as { id: string; deleted: boolean; sessionsEnded: number };
      expect(delBody.id).toBe(assistantId);
      expect(delBody.deleted).toBe(true);
      expect(delBody.sessionsEnded).toBeGreaterThanOrEqual(1);

      // Verify membership row is permanently gone from DB
      const row = await systemPrisma.membership.findUnique({
        where: { id: assistantId },
      });
      expect(row).toBeNull();

      // Verify audit entry
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: t.id,
          action: "assistant.delete",
          targetId: assistantId,
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(teacher.user.id);

      // Verify deleted assistant's session cookie is immediately invalidated
      const meAfter = await http.send(host(t), "GET", "/api/me", undefined, {
        cookie: assistantCookie,
      });
      expect(meAfter.status).toBe(401);
    });

    it("returns 404 when assistant membership is not found", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const res = await as(t, teacher.cookie, "DELETE", `/assistants/${randomUUID()}`);
      expect(res.status).toBe(404);
      expect((res.body as { code?: string }).code).toBe("ASSISTANT_NOT_FOUND");
    });

    it("returns 404 when attempting to delete a teacher or student membership via /assistants/:id", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      // Create student
      const student = await fx.member(t.id, "student");

      // Attempt to delete student membership on /assistants/:id
      const delStudent = await as(
        t,
        teacher.cookie,
        "DELETE",
        `/assistants/${student.membership.id}`,
      );
      expect(delStudent.status).toBe(404);

      // Attempt to delete teacher membership on /assistants/:id
      const teacherMember = await systemPrisma.membership.findFirst({
        where: { tenantId: t.id, role: "teacher" },
      });
      const delTeacher = await as(t, teacher.cookie, "DELETE", `/assistants/${teacherMember?.id}`);
      expect(delTeacher.status).toBe(404);
    });
  });

  describe("Role Barriers & Tenant Isolation", () => {
    it("rejects assistant attempting to manage assistants with 403 ROLE_FORBIDDEN", async () => {
      const t = await fx.tenant();
      const assistant = await fx.staffLogin(t, "assistant");

      const postRes = await as(t, assistant.cookie, "POST", "/assistants", {
        name: "Hacker Assistant",
        email: "hack@example.com",
        temporaryPassword: "TempPassword123!",
      });
      expect(postRes.status).toBe(403);
      expect(reasonOf(postRes.body)).toBe("ROLE_FORBIDDEN");

      const getRes = await as(t, assistant.cookie, "GET", "/assistants");
      expect(getRes.status).toBe(403);
      expect(reasonOf(getRes.body)).toBe("ROLE_FORBIDDEN");

      const delRes = await as(t, assistant.cookie, "DELETE", `/assistants/${randomUUID()}`);
      expect(delRes.status).toBe(403);
      expect(reasonOf(delRes.body)).toBe("ROLE_FORBIDDEN");
    });

    it("rejects student attempting to access assistant routes with 403 ROLE_FORBIDDEN", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const login = await fx.studentLogin(t, user.email);

      const postRes = await as(t, login.cookies, "POST", "/assistants", {
        name: "Student Imposter",
        email: "imposter@example.com",
        temporaryPassword: "TempPassword123!",
      });
      expect(postRes.status).toBe(403);
      expect(reasonOf(postRes.body)).toBe("ROLE_FORBIDDEN");

      const getRes = await as(t, login.cookies, "GET", "/assistants");
      expect(getRes.status).toBe(403);

      const delRes = await as(t, login.cookies, "DELETE", `/assistants/${randomUUID()}`);
      expect(delRes.status).toBe(403);
    });

    it("rejects unauthenticated requests with 401", async () => {
      const t = await fx.tenant();

      expect((await anon(t, "GET", "/assistants")).status).toBe(401);
      expect((await anon(t, "POST", "/assistants", {})).status).toBe(401);
      expect((await anon(t, "DELETE", `/assistants/${randomUUID()}`)).status).toBe(401);
    });

    it("enforces tenant isolation: Teacher A cannot delete Assistant on Tenant B", async () => {
      const tA = await fx.tenant();
      const tB = await fx.tenant();
      const teacherA = await fx.staffLogin(tA, "teacher");
      const teacherB = await fx.staffLogin(tB, "teacher");

      // Create assistant on Tenant B
      const createdOnB = await as(tB, teacherB.cookie, "POST", "/assistants", {
        name: "Tenant B Assistant",
        email: `tb-asst-${randomUUID().slice(0, 8)}@example.com`,
        temporaryPassword: "TempPassword123!",
      });
      const assistantBId = (createdOnB.body as { id: string }).id;

      // Teacher A attempts to delete Assistant on Tenant B
      const crossDel = await as(tA, teacherA.cookie, "DELETE", `/assistants/${assistantBId}`);
      expect(crossDel.status).toBe(404);
      expect((crossDel.body as { code?: string }).code).toBe("ASSISTANT_NOT_FOUND");

      // Verify Assistant B still exists on Tenant B
      const checkB = await systemPrisma.membership.findUnique({
        where: { id: assistantBId },
      });
      expect(checkB).not.toBeNull();
    });

    it("allows super admin to manage assistants across tenants", async () => {
      const t = await fx.tenant();
      const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });

      const email = `admin-asst-${randomUUID().slice(0, 8)}@example.com`;
      const created = await as(t, admin.cookie, "POST", "/assistants", {
        name: "Admin Assistant",
        email,
        temporaryPassword: "TempPassword123!",
      });
      expect(created.status).toBe(201);
      const assistantId = (created.body as { id: string }).id;

      const listRes = await as(t, admin.cookie, "GET", "/assistants");
      expect(listRes.status).toBe(200);

      const delRes = await as(t, admin.cookie, "DELETE", `/assistants/${assistantId}`);
      expect(delRes.status).toBe(200);
    });
  });
});
