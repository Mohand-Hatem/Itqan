// Step 9.8a: General support requests API (FR-N05).
import { auth } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, SupportRequestReason } from "@itqan/shared";
import type { APIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "SupportGeneralPassword123!";
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

const createRequest = (t: Tenant, cookie: string, message: unknown) =>
  http.send(host(t), "POST", "/api/support-requests", { message }, { cookie });

const listRequests = (t: Tenant, cookie: string, query = "") =>
  http.send(host(t), "GET", `/api/support-requests${query}`, undefined, { cookie });

const closeRequest = (t: Tenant, cookie: string, id: string, response?: string) =>
  http.send(host(t), "POST", `/api/support-requests/${id}/close`, { response }, { cookie });

describe("Step 9.8a: General Support Requests API", () => {
  describe("student create", () => {
    it("student successfully opens a general support request", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const student = await studentLogin(t, user.email);

      const res = await createRequest(
        t,
        student.cookies,
        "Hello, I am having trouble with course materials.",
      );

      expect(res.status).toBe(201);
      const body = res.body as {
        id: string;
        type: string;
        status: string;
        message: string;
        createdAt: string;
      };
      expect(body.id).toBeDefined();
      expect(body.type).toBe("general");
      expect(body.status).toBe("open");
      expect(body.message).toBe("Hello, I am having trouble with course materials.");

      // Check DB persistence
      const row = await systemPrisma.supportRequest.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(row.type).toBe("general");
      expect(row.status).toBe("open");
      expect(row.message).toBe("Hello, I am having trouble with course materials.");

      // Check audit log
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: t.id,
          targetId: body.id,
          action: "support_request.create",
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(user.id);
    });

    it("rejects invalid or too short message with 400", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const student = await studentLogin(t, user.email);

      // Too short (< 5 chars)
      const resShort = await createRequest(t, student.cookies, "Hi");
      expect(resShort.status).toBe(400);

      // Empty / whitespace
      const resEmpty = await createRequest(t, student.cookies, "    ");
      expect(resEmpty.status).toBe(400);

      // Non-string
      const resNonStr = await createRequest(t, student.cookies, 12345);
      expect(resNonStr.status).toBe(400);
    });
  });

  describe("listing", () => {
    it("student sees only own requests; staff sees all tenant requests", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");

      const { user: student1User } = await fx.member(t.id, "student");
      const student1 = await studentLogin(t, student1User.email);

      const { user: student2User } = await fx.member(t.id, "student");
      const student2 = await studentLogin(t, student2User.email);

      // Student 1 creates two requests
      const req1 = await createRequest(t, student1.cookies, "Student 1 first issue");
      const req2 = await createRequest(t, student1.cookies, "Student 1 second issue");
      const req1Id = (req1.body as { id: string }).id;
      const req2Id = (req2.body as { id: string }).id;

      // Student 2 creates one request
      const req3 = await createRequest(t, student2.cookies, "Student 2 single issue");
      const req3Id = (req3.body as { id: string }).id;

      // Student 1 lists support requests: sees only req1 and req2
      const resStudent1 = await listRequests(t, student1.cookies);
      expect(resStudent1.status).toBe(200);
      const student1Items = (resStudent1.body as { items: { id: string }[] }).items;
      expect(student1Items.map((i) => i.id)).toEqual([req2Id, req1Id]);
      expect(student1Items.some((i) => i.id === req3Id)).toBe(false);

      // Student 2 lists support requests: sees only req3
      const resStudent2 = await listRequests(t, student2.cookies);
      expect(resStudent2.status).toBe(200);
      const student2Items = (resStudent2.body as { items: { id: string }[] }).items;
      expect(student2Items.map((i) => i.id)).toEqual([req3Id]);

      // Teacher lists support requests: sees all 3 requests with student details
      const resTeacher = await listRequests(t, teacher.cookie);
      expect(resTeacher.status).toBe(200);
      const teacherItems = (
        resTeacher.body as {
          items: {
            id: string;
            student: { email: string; name: string };
          }[];
        }
      ).items;
      const teacherIds = teacherItems.map((i) => i.id);
      expect(teacherIds).toContain(req1Id);
      expect(teacherIds).toContain(req2Id);
      expect(teacherIds).toContain(req3Id);

      const item1 = teacherItems.find((i) => i.id === req1Id)!;
      expect(item1.student.email).toBe(student1User.email);
    });

    it("supports cursor pagination and filters for students and staff", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const student = await studentLogin(t, user.email);

      const r1 = (await createRequest(t, student.cookies, "Issue number 1")).body as { id: string };
      const r2 = (await createRequest(t, student.cookies, "Issue number 2")).body as { id: string };
      const r3 = (await createRequest(t, student.cookies, "Issue number 3")).body as { id: string };

      // Page 1 (limit=2): newest first -> r3, r2
      const page1 = await listRequests(t, student.cookies, "?limit=2");
      expect(page1.status).toBe(200);
      const body1 = page1.body as { items: { id: string }[]; nextCursor: string | null };
      expect(body1.items.map((i) => i.id)).toEqual([r3.id, r2.id]);
      expect(body1.nextCursor).toBe(r2.id);

      // Page 2 (cursor=r2.id): r1
      const page2 = await listRequests(t, student.cookies, `?limit=2&cursor=${body1.nextCursor}`);
      expect(page2.status).toBe(200);
      const body2 = page2.body as { items: { id: string }[]; nextCursor: string | null };
      expect(body2.items.map((i) => i.id)).toEqual([r1.id]);
      expect(body2.nextCursor).toBeNull();
    });
  });

  describe("staff resolution", () => {
    it("staff closes request with answer, updates status, and dispatches in-app notification", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");
      const { user: studentUser } = await fx.member(t.id, "student");
      const student = await studentLogin(t, studentUser.email);

      // Student creates request
      const createRes = await createRequest(
        t,
        student.cookies,
        "Cannot access module 2 quiz after completing module 1.",
      );
      const requestId = (createRes.body as { id: string }).id;

      // Teacher closes with answer
      const closeRes = await closeRequest(
        t,
        teacher.cookie,
        requestId,
        "Access to module 2 quiz has been granted. Refresh your dashboard.",
      );
      expect(closeRes.status).toBe(200);
      const closeBody = closeRes.body as {
        id: string;
        status: string;
        response: string;
        decidedAt: string;
      };
      expect(closeBody.id).toBe(requestId);
      expect(closeBody.status).toBe("closed");
      expect(closeBody.response).toBe(
        "Access to module 2 quiz has been granted. Refresh your dashboard.",
      );

      // DB check
      const row = await systemPrisma.supportRequest.findUniqueOrThrow({
        where: { id: requestId },
      });
      expect(row.status).toBe("closed");
      expect(row.response).toBe("Access to module 2 quiz has been granted. Refresh your dashboard.");
      expect(row.decidedById).toBe(teacher.user.id);
      expect(row.decidedAt).not.toBeNull();

      // Check student sees response in their list
      const listRes = await listRequests(t, student.cookies);
      const items = (
        listRes.body as {
          items: { id: string; status: string; response: string | null }[];
        }
      ).items;
      const found = items.find((i) => i.id === requestId);
      expect(found).toBeDefined();
      expect(found?.status).toBe("closed");
      expect(found?.response).toBe("Access to module 2 quiz has been granted. Refresh your dashboard.");

      // Check in-app notification created for the student
      const notification = await systemPrisma.notification.findFirst({
        where: {
          tenantId: t.id,
          userId: studentUser.id,
          type: "support_request_decided",
        },
      });
      expect(notification).not.toBeNull();
      expect(notification?.title).toBe("Support request updated");
      expect(notification?.body).toContain("Access to module 2 quiz has been granted");

      // Audit log check
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: t.id,
          targetId: requestId,
          action: "support_request.close",
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(teacher.user.id);
    });

    it("second close click receives 409 REQUEST_NOT_OPEN", async () => {
      const t = await fx.tenant();
      const teacher = await staff(t, "teacher");
      const { user: studentUser } = await fx.member(t.id, "student");
      const student = await studentLogin(t, studentUser.email);

      const createRes = await createRequest(t, student.cookies, "Another question");
      const requestId = (createRes.body as { id: string }).id;

      // First close succeeds
      const firstClose = await closeRequest(t, teacher.cookie, requestId, "Done");
      expect(firstClose.status).toBe(200);

      // Second close fails with 409
      const secondClose = await closeRequest(t, teacher.cookie, requestId, "Done again");
      expect(secondClose.status).toBe(409);
      expect((secondClose.body as { reason?: string }).reason).toBe(
        SupportRequestReason.REQUEST_NOT_OPEN,
      );
    });

    it("student cannot close support requests (403 ROLE_FORBIDDEN)", async () => {
      const t = await fx.tenant();
      const { user: studentUser } = await fx.member(t.id, "student");
      const student = await studentLogin(t, studentUser.email);

      const createRes = await createRequest(t, student.cookies, "Student inquiry");
      const requestId = (createRes.body as { id: string }).id;

      const res = await closeRequest(t, student.cookies, requestId, "Student closing");
      expect(res.status).toBe(403);
      expect((res.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    });

    it("cross-tenant isolation: Tenant A staff cannot close Tenant B requests (404)", async () => {
      const [tA, tB] = [await fx.tenant(), await fx.tenant()];
      const teacherA = await staff(tA, "teacher");
      const { user: studentBUser } = await fx.member(tB.id, "student");
      const studentB = await studentLogin(tB, studentBUser.email);

      const createRes = await createRequest(tB, studentB.cookies, "Tenant B inquiry");
      const reqBId = (createRes.body as { id: string }).id;

      const closeRes = await closeRequest(tA, teacherA.cookie, reqBId, "Attempt from Tenant A");
      expect(closeRes.status).toBe(404);
    });
  });
});
