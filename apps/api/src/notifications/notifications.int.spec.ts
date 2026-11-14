import { randomUUID } from "node:crypto";
import { auth, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";

let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let tenantSlugA: string;
let tenantHostA: string;
let tenantIdA: string;

let tenantSlugB: string;
let tenantHostB: string;
let tenantIdB: string;

const createdUserIds: string[] = [];

function toCookieHeader(headers: Headers): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") || ""];

  return setCookies
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function createAuthenticatedStudent(opts: {
  name: string;
  tenantId: string;
  tenantHost: string;
}): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `notif-student-${randomUUID().slice(0, 8)}@example.com`;
  const password = "StrongPassword123!";

  const signUp = await auth.api.signUpEmail({
    body: { email, password, name: opts.name },
  });
  createdUserIds.push(signUp.user.id);

  const verificationEmail = getLastSentEmail(email);
  if (verificationEmail) {
    const url = new URL(verificationEmail.url);
    const token = url.searchParams.get("token");
    if (token) {
      await auth.api.verifyEmail({ query: { token } });
    }
  }

  await systemPrisma.membership.create({
    data: { tenantId: opts.tenantId, userId: signUp.user.id, role: "student" },
  });

  const signIn = await auth.api.signInStudent({
    body: { email, password },
    headers: new Headers({ host: opts.tenantHost }),
    returnHeaders: true,
  });

  const cookie = toCookieHeader(signIn.headers);
  return { userId: signUp.user.id, email, cookie };
}

describe("Notifications API over HTTP (integration)", () => {
  beforeAll(async () => {
    http = await createHttpTestApp(AppModule);

    // Tenant A
    tenantSlugA = `notif-t-a-${randomUUID().slice(0, 8)}`;
    tenantHostA = `${tenantSlugA}.localhost`;
    const tA = await systemPrisma.tenant.create({
      data: { name: `Tenant A ${tenantSlugA}`, slug: tenantSlugA },
    });
    tenantIdA = tA.id;

    // Tenant B
    tenantSlugB = `notif-t-b-${randomUUID().slice(0, 8)}`;
    tenantHostB = `${tenantSlugB}.localhost`;
    const tB = await systemPrisma.tenant.create({
      data: { name: `Tenant B ${tenantSlugB}`, slug: tenantSlugB },
    });
    tenantIdB = tB.id;
  });

  afterAll(async () => {
    await http.close();

    if (createdUserIds.length > 0) {
      await systemPrisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.membership.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    if (tenantIdA) {
      await systemPrisma.tenant.delete({ where: { id: tenantIdA } });
    }
    if (tenantIdB) {
      await systemPrisma.tenant.delete({ where: { id: tenantIdB } });
    }
  });

  it("returns 401 Unauthorized without a valid session", async () => {
    const res = await http.send(tenantHostA, "GET", "/api/notifications");
    expect(res.status).toBe(401);
  });

  it("returns empty notification list and 0 unreadCount for a user with no notifications", async () => {
    const student = await createAuthenticatedStudent({
      name: "Clean Student",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    const res = await http.send(tenantHostA, "GET", "/api/notifications", undefined, {
      cookie: student.cookie,
    });

    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.body as any;
    expect(body.items).toEqual([]);
    expect(body.unreadCount).toBe(0);
    expect(body.nextCursor).toBeNull();
  });

  it("lists notifications, filters by unreadOnly, and marks read", async () => {
    const userA = await createAuthenticatedStudent({
      name: "User A",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    // Seed 3 notifications for userA
    const n1 = await systemPrisma.notification.create({
      data: {
        tenantId: tenantIdA,
        userId: userA.userId,
        type: "announcement",
        title: "Welcome Notice",
        body: "Welcome to class",
        data: { noticeId: "n1" },
        createdAt: new Date(Date.now() - 3000),
      },
    });

    const n2 = await systemPrisma.notification.create({
      data: {
        tenantId: tenantIdA,
        userId: userA.userId,
        type: "exam_opening",
        title: "Quiz 1 Opened",
        body: "You have 30 minutes",
        data: { quizId: "q1" },
        createdAt: new Date(Date.now() - 2000),
      },
    });

    const n3 = await systemPrisma.notification.create({
      data: {
        tenantId: tenantIdA,
        userId: userA.userId,
        type: "grade_released",
        title: "Quiz 1 Graded",
        body: "Grade is available",
        data: { quizId: "q1", score: 95 },
        createdAt: new Date(Date.now() - 1000),
      },
    });

    // 1. Initial list: all 3 unread, newest first
    const res1 = await http.send(tenantHostA, "GET", "/api/notifications", undefined, {
      cookie: userA.cookie,
    });
    expect(res1.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body1 = res1.body as any;
    expect(body1.unreadCount).toBe(3);
    expect(body1.items).toHaveLength(3);
    expect(body1.items[0].id).toBe(n3.id);
    expect(body1.items[1].id).toBe(n2.id);
    expect(body1.items[2].id).toBe(n1.id);
    expect(body1.items[0].readAt).toBeNull();

    // 2. Mark specific notification read (n3)
    const patchRes1 = await http.send(
      tenantHostA,
      "PATCH",
      "/api/notifications/read",
      { ids: [n3.id] },
      { cookie: userA.cookie },
    );
    expect(patchRes1.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((patchRes1.body as any).updatedCount).toBe(1);

    // 3. Query unreadOnly=true: should now return n2 and n1, with unreadCount = 2
    const res2 = await http.send(
      tenantHostA,
      "GET",
      "/api/notifications?unreadOnly=true",
      undefined,
      { cookie: userA.cookie },
    );
    expect(res2.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body2 = res2.body as any;
    expect(body2.unreadCount).toBe(2);
    expect(body2.items).toHaveLength(2);
    expect(body2.items.map((i: { id: string }) => i.id)).toEqual([n2.id, n1.id]);

    // 4. Mark all remaining read with empty object
    const patchResAll = await http.send(
      tenantHostA,
      "PATCH",
      "/api/notifications/read",
      {},
      { cookie: userA.cookie },
    );
    expect(patchResAll.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((patchResAll.body as any).updatedCount).toBe(2);

    // 5. Final check: unreadCount is now 0
    const res3 = await http.send(tenantHostA, "GET", "/api/notifications", undefined, {
      cookie: userA.cookie,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body3 = res3.body as any;
    expect(body3.unreadCount).toBe(0);
    expect(body3.items).toHaveLength(3);
    expect(body3.items.every((i: { readAt: string | null }) => i.readAt !== null)).toBe(true);
  });

  it("enforces tenant and user isolation over HTTP", async () => {
    const userA = await createAuthenticatedStudent({
      name: "User A Iso",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });
    const userB = await createAuthenticatedStudent({
      name: "User B Iso",
      tenantId: tenantIdB,
      tenantHost: tenantHostB,
    });

    const notifA = await systemPrisma.notification.create({
      data: {
        tenantId: tenantIdA,
        userId: userA.userId,
        type: "test",
        title: "Confidential A",
        body: "Secret A",
      },
    });

    // User B on Tenant B cannot see User A's notification
    const resB = await http.send(tenantHostB, "GET", "/api/notifications", undefined, {
      cookie: userB.cookie,
    });
    expect(resB.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bodyB = resB.body as any;
    expect(bodyB.items).toHaveLength(0);
    expect(bodyB.unreadCount).toBe(0);

    // User B on Tenant B attempts to mark User A's notification as read
    const patchB = await http.send(
      tenantHostB,
      "PATCH",
      "/api/notifications/read",
      { ids: [notifA.id] },
      { cookie: userB.cookie },
    );
    expect(patchB.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((patchB.body as any).updatedCount).toBe(0);

    // Verify notifA remains unread in database
    const freshNotifA = await systemPrisma.notification.findUnique({
      where: { id: notifA.id },
    });
    expect(freshNotifA?.readAt).toBeNull();
  });

  it("rejects malformed requests with 400", async () => {
    const student = await createAuthenticatedStudent({
      name: "Val Student",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    // Invalid query param (limit not a valid number or out of bounds)
    const badQuery = await http.send(
      tenantHostA,
      "GET",
      "/api/notifications?limit=9999",
      undefined,
      { cookie: student.cookie },
    );
    expect(badQuery.status).toBe(400);

    // Invalid body (ids is not an array of uuids)
    const badBody = await http.send(
      tenantHostA,
      "PATCH",
      "/api/notifications/read",
      { ids: ["not-a-uuid"] },
      { cookie: student.cookie },
    );
    expect(badBody.status).toBe(400);
  });
});
