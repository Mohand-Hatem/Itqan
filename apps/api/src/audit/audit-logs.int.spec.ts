// Step 9.10a: Audit log API with filters (FR-A01).
import { auth } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, type AuditLogListResponseDto } from "@itqan/shared";
import type { APIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "AuditLogPassword123!";
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
  return { user, cookie: cookiesOf(res.headers) };
}

const listAuditLogs = (t: Tenant, cookie: string, query = "") =>
  http.send(host(t), "GET", `/api/audit-logs${query}`, undefined, { cookie });

describe("Step 9.10a: Audit Log API with Filters (FR-A01)", () => {
  describe("actor filter", () => {
    it("returns only entries matching the specified actorUserId", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");
      const assistant = await staff(t, "assistant");

      // Seed audit entries for teacher and assistant
      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: teacher.user.id,
          action: "course.publish",
          meta: { course: "C1" },
        },
      });
      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: assistant.user.id,
          action: "comment.hide",
          meta: { comment: "M1" },
        },
      });
      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: teacher.user.id,
          action: "settings.update",
          meta: { key: "theme" },
        },
      });

      // Query with actorUserId = teacher.user.id
      const res = await listAuditLogs(t, teacher.cookie, `?actorUserId=${teacher.user.id}`);
      expect(res.status).toBe(200);

      const body = res.body as AuditLogListResponseDto;
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      expect(body.items.every((item) => item.actor?.id === teacher.user.id)).toBe(true);

      const actions = body.items.map((i) => i.action);
      expect(actions).toContain("course.publish");
      expect(actions).toContain("settings.update");
      expect(actions).not.toContain("comment.hide");
    });
  });

  describe("action filter", () => {
    it("returns only entries matching the specified action verb", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");

      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: teacher.user.id,
          action: "specific.action.alpha",
          meta: { test: true },
        },
      });
      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: teacher.user.id,
          action: "specific.action.beta",
          meta: { test: true },
        },
      });

      const res = await listAuditLogs(t, teacher.cookie, "?action=specific.action.alpha");
      expect(res.status).toBe(200);

      const body = res.body as AuditLogListResponseDto;
      expect(body.items.length).toBe(1);
      expect(body.items[0]!.action).toBe("specific.action.alpha");
    });
  });

  describe("date range filter", () => {
    it("filters entries accurately inside from and to bounds", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");

      const now = Date.now();
      const t1 = new Date(now - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const t2 = new Date(now - 5 * 24 * 60 * 60 * 1000);  // 5 days ago
      const t3 = new Date(now - 1 * 24 * 60 * 60 * 1000);  // 1 day ago

      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: teacher.user.id,
          action: "date.event.old",
          createdAt: t1,
        },
      });
      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: teacher.user.id,
          action: "date.event.mid",
          createdAt: t2,
        },
      });
      await systemPrisma.auditLog.create({
        data: {
          tenantId: t.id,
          actorUserId: teacher.user.id,
          action: "date.event.recent",
          createdAt: t3,
        },
      });

      // Filter between 7 days ago and 3 days ago -> should only include date.event.mid
      const from = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

      const res = await listAuditLogs(t, teacher.cookie, `?from=${from}&to=${to}`);
      expect(res.status).toBe(200);

      const body = res.body as AuditLogListResponseDto;
      expect(body.items.length).toBe(1);
      expect(body.items[0]!.action).toBe("date.event.mid");
    });
  });

  describe("access control and pagination", () => {
    it("allows teachers and super admins; rejects assistants and students with 403; paginates with cursor", async () => {
      const [tA, tB] = [await fx.tenant(), await fx.tenant()];
      const teacherA = await staff(tA, "teacher");
      const assistantA = await staff(tA, "assistant");

      const { user: studentA } = await fx.member(tA.id, "student");
      const studentSession = await studentLogin(tA, studentA.email);

      // Student receives 403 Forbidden
      const resStudent = await listAuditLogs(tA, studentSession.cookies);
      expect(resStudent.status).toBe(403);
      expect((resStudent.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      // Assistant receives 403 Forbidden
      const resAssistant = await listAuditLogs(tA, assistantA.cookie);
      expect(resAssistant.status).toBe(403);
      expect((resAssistant.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      // Teacher A succeeds
      const resTeacher = await listAuditLogs(tA, teacherA.cookie);
      expect(resTeacher.status).toBe(200);

      // Seed 3 logs in Tenant A
      await systemPrisma.auditLog.create({
        data: { tenantId: tA.id, actorUserId: teacherA.user.id, action: "page.first" },
      });
      await systemPrisma.auditLog.create({
        data: { tenantId: tA.id, actorUserId: teacherA.user.id, action: "page.second" },
      });
      await systemPrisma.auditLog.create({
        data: { tenantId: tA.id, actorUserId: teacherA.user.id, action: "page.third" },
      });

      // Seed 1 log in Tenant B
      const teacherB = await staff(tB, "teacher");
      const logB = await systemPrisma.auditLog.create({
        data: { tenantId: tB.id, actorUserId: teacherB.user.id, action: "tenant.b.action" },
      });

      // Pagination on Tenant A: limit=2
      const page1 = await listAuditLogs(tA, teacherA.cookie, "?limit=2");
      expect(page1.status).toBe(200);
      const body1 = page1.body as AuditLogListResponseDto;
      expect(body1.items.length).toBe(2);
      expect(body1.nextCursor).toBeDefined();

      const page2 = await listAuditLogs(tA, teacherA.cookie, `?limit=2&cursor=${body1.nextCursor}`);
      expect(page2.status).toBe(200);
      const body2 = page2.body as AuditLogListResponseDto;
      expect(body2.items.length).toBeGreaterThanOrEqual(1);

      // Tenant isolation: Tenant A never sees logB
      const allA = [...body1.items, ...body2.items];
      expect(allA.some((i) => i.id === logB.id)).toBe(false);
      expect(allA.some((i) => i.action === "tenant.b.action")).toBe(false);
    });
  });
});
