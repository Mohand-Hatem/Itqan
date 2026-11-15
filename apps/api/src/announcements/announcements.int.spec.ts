import { randomUUID } from "node:crypto";
import { auth, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";

let http: Awaited<ReturnType<typeof createHttpTestApp>>;

let tenantIdA: string;
let tenantSlugA: string;
let tenantHostA: string;

let tenantIdB: string;
let tenantSlugB: string;
let tenantHostB: string;

let course1Id: string;
let course2Id: string;

let teacherA: { userId: string; email: string; cookie: string };
let student1: { userId: string; email: string; cookie: string; membershipId: string };
let student2: { userId: string; email: string; cookie: string; membershipId: string };
let student3: { userId: string; email: string; cookie: string; membershipId: string };
let studentB: { userId: string; email: string; cookie: string; membershipId: string };

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

async function createAuthenticatedTeacher(opts: {
  name: string;
  tenantId: string;
  tenantHost: string;
}): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `ann-teacher-${randomUUID().slice(0, 8)}@example.com`;
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
    data: { tenantId: opts.tenantId, userId: signUp.user.id, role: "teacher" },
  });

  const signIn = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ host: opts.tenantHost }),
    returnHeaders: true,
  });
  // Staff need TOTP (FR-A03, step 10.3); turned on after sign-in.
  await systemPrisma.user.update({ where: { email: email }, data: { twoFactorEnabled: true } });

  const cookie = toCookieHeader(signIn.headers);
  return { userId: signUp.user.id, email, cookie };
}

async function createAuthenticatedStudent(opts: {
  name: string;
  tenantId: string;
  tenantHost: string;
}): Promise<{ userId: string; email: string; cookie: string; membershipId: string }> {
  const email = `ann-student-${randomUUID().slice(0, 8)}@example.com`;
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

  const membership = await systemPrisma.membership.create({
    data: { tenantId: opts.tenantId, userId: signUp.user.id, role: "student" },
  });

  const signIn = await auth.api.signInStudent({
    body: { email, password },
    headers: new Headers({ host: opts.tenantHost }),
    returnHeaders: true,
  });

  const cookie = toCookieHeader(signIn.headers);
  return { userId: signUp.user.id, email, cookie, membershipId: membership.id };
}

describe("Announcements API (Integration)", () => {
  beforeAll(async () => {
    http = await createHttpTestApp(AppModule);

    // 1. Create Tenant A
    tenantSlugA = `ann-t-a-${randomUUID().slice(0, 8)}`;
    tenantHostA = `${tenantSlugA}.localhost`;
    const tA = await systemPrisma.tenant.create({
      data: { name: `Tenant A ${tenantSlugA}`, slug: tenantSlugA },
    });
    tenantIdA = tA.id;

    // 2. Create Tenant B
    tenantSlugB = `ann-t-b-${randomUUID().slice(0, 8)}`;
    tenantHostB = `${tenantSlugB}.localhost`;
    const tB = await systemPrisma.tenant.create({
      data: { name: `Tenant B ${tenantSlugB}`, slug: tenantSlugB },
    });
    tenantIdB = tB.id;

    // 3. Create Courses in Tenant A
    const c1 = await systemPrisma.course.create({
      data: { tenantId: tenantIdA, title: "Course 1 Tajweed", status: "published" },
    });
    course1Id = c1.id;

    const c2 = await systemPrisma.course.create({
      data: { tenantId: tenantIdA, title: "Course 2 Fiqh", status: "published" },
    });
    course2Id = c2.id;

    // 4. Create Users in Tenant A
    teacherA = await createAuthenticatedTeacher({
      name: "Teacher Omar",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    student1 = await createAuthenticatedStudent({
      name: "Student 1 (Course 1)",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    student2 = await createAuthenticatedStudent({
      name: "Student 2 (Course 2)",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    student3 = await createAuthenticatedStudent({
      name: "Student 3 (Both Courses)",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    // 5. Enrollments:
    // Student 1 -> Course 1
    await systemPrisma.enrollment.create({
      data: {
        tenantId: tenantIdA,
        courseId: course1Id,
        membershipId: student1.membershipId,
        source: "manual",
        grantedBy: teacherA.userId,
        status: "active",
      },
    });

    // Student 2 -> Course 2
    await systemPrisma.enrollment.create({
      data: {
        tenantId: tenantIdA,
        courseId: course2Id,
        membershipId: student2.membershipId,
        source: "manual",
        grantedBy: teacherA.userId,
        status: "active",
      },
    });

    // Student 3 -> Course 1 and Course 2
    await systemPrisma.enrollment.create({
      data: {
        tenantId: tenantIdA,
        courseId: course1Id,
        membershipId: student3.membershipId,
        source: "manual",
        grantedBy: teacherA.userId,
        status: "active",
      },
    });
    await systemPrisma.enrollment.create({
      data: {
        tenantId: tenantIdA,
        courseId: course2Id,
        membershipId: student3.membershipId,
        source: "manual",
        grantedBy: teacherA.userId,
        status: "active",
      },
    });

    // 6. Tenant B Student
    studentB = await createAuthenticatedStudent({
      name: "Student B",
      tenantId: tenantIdB,
      tenantHost: tenantHostB,
    });

    // 7. Seed baseline announcements for fencing tests
    await http.send(
      tenantHostA,
      "POST",
      "/api/announcements",
      {
        title: "Welcome All Students",
        body: "Welcome to the new academic term. Best of luck!",
      },
      { cookie: teacherA.cookie },
    );

    await http.send(
      tenantHostA,
      "POST",
      "/api/announcements",
      {
        title: "Course 1 Midterm Scheduled",
        body: "The midterm exam for Course 1 will take place on Sunday.",
        courseId: course1Id,
      },
      { cookie: teacherA.cookie },
    );

    await http.send(
      tenantHostA,
      "POST",
      "/api/announcements",
      {
        title: "Course 2 Fiqh Research Topic",
        body: "Submit your research topics by next Wednesday.",
        courseId: course2Id,
      },
      { cookie: teacherA.cookie },
    );
  });

  afterAll(async () => {
    await http.close();

    // Delete tenants first (cascades audit logs and tenant rows without triggering audit log immutability check)
    if (tenantIdA) {
      await systemPrisma.tenant.delete({ where: { id: tenantIdA } }).catch(() => {});
    }
    if (tenantIdB) {
      await systemPrisma.tenant.delete({ where: { id: tenantIdB } }).catch(() => {});
    }

    if (createdUserIds.length > 0) {
      await systemPrisma.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      }).catch(() => {});
    }
  });

  describe("publish and fanout (Gate G2)", () => {
    it("staff can publish tenant-wide announcement; creates notifications for all tenant students and logs audit", async () => {
      const res = await http.send(
        tenantHostA,
        "POST",
        "/api/announcements",
        {
          title: "Broadcast To All Students",
          body: "Welcome to the new academic term. Best of luck!",
        },
        { cookie: teacherA.cookie },
      );

      expect(res.status).toBe(201);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.body as any;
      expect(data.id).toBeDefined();
      expect(data.title).toBe("Broadcast To All Students");
      expect(data.courseId).toBeNull();
      expect(data.authorName).toBe("Teacher Omar");

      // Verify notifications were created for all active students in Tenant A
      const notifs1 = await systemPrisma.notification.findMany({
        where: { tenantId: tenantIdA, userId: student1.userId, type: "announcement" },
      });
      expect(notifs1.some((n) => n.title === "Broadcast To All Students")).toBe(true);

      const notifs2 = await systemPrisma.notification.findMany({
        where: { tenantId: tenantIdA, userId: student2.userId, type: "announcement" },
      });
      expect(notifs2.some((n) => n.title === "Broadcast To All Students")).toBe(true);

      const notifs3 = await systemPrisma.notification.findMany({
        where: { tenantId: tenantIdA, userId: student3.userId, type: "announcement" },
      });
      expect(notifs3.some((n) => n.title === "Broadcast To All Students")).toBe(true);

      // Verify audit log was recorded
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: tenantIdA,
          action: "announcement.create",
          targetId: data.id,
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(teacherA.userId);
    });

    it("staff can publish course-specific announcement; only enrolled students get notifications", async () => {
      const res = await http.send(
        tenantHostA,
        "POST",
        "/api/announcements",
        {
          title: "Course 1 Targeted Announcement",
          body: "The midterm exam for Course 1 will take place on Sunday.",
          courseId: course1Id,
        },
        { cookie: teacherA.cookie },
      );

      expect(res.status).toBe(201);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.body as any;
      expect(data.courseId).toBe(course1Id);

      // Student 1 (enrolled in Course 1) MUST receive notification
      const notifStudent1 = await systemPrisma.notification.findFirst({
        where: {
          tenantId: tenantIdA,
          userId: student1.userId,
          title: "Course 1 Targeted Announcement",
        },
      });
      expect(notifStudent1).not.toBeNull();

      // Student 3 (enrolled in Course 1) MUST receive notification
      const notifStudent3 = await systemPrisma.notification.findFirst({
        where: {
          tenantId: tenantIdA,
          userId: student3.userId,
          title: "Course 1 Targeted Announcement",
        },
      });
      expect(notifStudent3).not.toBeNull();

      // Student 2 (enrolled ONLY in Course 2) MUST NOT receive notification
      const notifStudent2 = await systemPrisma.notification.findFirst({
        where: {
          tenantId: tenantIdA,
          userId: student2.userId,
          title: "Course 1 Targeted Announcement",
        },
      });
      expect(notifStudent2).toBeNull();
    });

    it("students cannot publish announcements (403 Forbidden)", async () => {
      const res = await http.send(
        tenantHostA,
        "POST",
        "/api/announcements",
        {
          title: "Unauthorized Announcement",
          body: "Should fail.",
        },
        { cookie: student1.cookie },
      );

      expect(res.status).toBe(403);
    });
  });

  describe("course fencing (Gate G3)", () => {
    it("student query without courseId returns tenant-wide announcements and enrolled course announcements only", async () => {
      // Student 1 (enrolled in Course 1 only) queries without courseId
      const resStudent1 = await http.send(tenantHostA, "GET", "/api/announcements", undefined, {
        cookie: student1.cookie,
      });
      expect(resStudent1.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items1 = (resStudent1.body as any).items;
      const titles1 = items1.map((i: { title: string }) => i.title);

      // Should see tenant-wide and Course 1
      expect(titles1).toContain("Welcome All Students");
      expect(titles1).toContain("Course 1 Midterm Scheduled");
      // Must NOT see Course 2
      expect(titles1).not.toContain("Course 2 Fiqh Research Topic");

      // Student 2 (enrolled in Course 2 only) queries without courseId
      const resStudent2 = await http.send(tenantHostA, "GET", "/api/announcements", undefined, {
        cookie: student2.cookie,
      });
      expect(resStudent2.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items2 = (resStudent2.body as any).items;
      const titles2 = items2.map((i: { title: string }) => i.title);

      expect(titles2).toContain("Welcome All Students");
      expect(titles2).toContain("Course 2 Fiqh Research Topic");
      expect(titles2).not.toContain("Course 1 Midterm Scheduled");

      // Student 3 (enrolled in both courses) should see all three
      const resStudent3 = await http.send(tenantHostA, "GET", "/api/announcements", undefined, {
        cookie: student3.cookie,
      });
      expect(resStudent3.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items3 = (resStudent3.body as any).items;
      const titles3 = items3.map((i: { title: string }) => i.title);

      expect(titles3).toContain("Welcome All Students");
      expect(titles3).toContain("Course 1 Midterm Scheduled");
      expect(titles3).toContain("Course 2 Fiqh Research Topic");
    });

    it("student querying announcements for a course they are not enrolled in returns 403 Forbidden", async () => {
      // Student 1 queries Course 2 (which they are NOT enrolled in)
      const res = await http.send(
        tenantHostA,
        "GET",
        `/api/announcements?courseId=${course2Id}`,
        undefined,
        { cookie: student1.cookie },
      );

      expect(res.status).toBe(403);
    });

    it("student querying announcements for their enrolled course returns 200 with only that course's announcements", async () => {
      const res = await http.send(
        tenantHostA,
        "GET",
        `/api/announcements?courseId=${course1Id}`,
        undefined,
        { cookie: student1.cookie },
      );

      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (res.body as any).items;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.courseId).toBe(course1Id);
      }
    });

    it("staff can view announcements for any course or all courses", async () => {
      const res = await http.send(
        tenantHostA,
        "GET",
        `/api/announcements?courseId=${course2Id}`,
        undefined,
        { cookie: teacherA.cookie },
      );

      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (res.body as any).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i: { courseId: string }) => i.courseId === course2Id)).toBe(true);
    });

    it("cross-tenant isolation: student in Tenant B cannot view Tenant A announcements", async () => {
      const res = await http.send(tenantHostB, "GET", "/api/announcements", undefined, {
        cookie: studentB.cookie,
      });

      expect(res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items = (res.body as any).items;
      expect(items.length).toBe(0);
    });
  });

  describe("pagination (Gate G4)", () => {
    it("navigates multiple pages via keyset cursor pagination over publishedAt desc, id desc without duplicates", async () => {
      // Create 25 announcements in Tenant A
      for (let i = 1; i <= 25; i++) {
        await http.send(
          tenantHostA,
          "POST",
          "/api/announcements",
          {
            title: `Batch Announcement ${i}`,
            body: `Body for announcement ${i}`,
          },
          { cookie: teacherA.cookie },
        );
      }

      // Fetch page 1 (limit 10)
      const page1Res = await http.send(
        tenantHostA,
        "GET",
        "/api/announcements?limit=10",
        undefined,
        { cookie: teacherA.cookie },
      );
      expect(page1Res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page1 = page1Res.body as any;
      expect(page1.items.length).toBe(10);
      expect(page1.nextCursor).not.toBeNull();

      // Fetch page 2 (limit 10, cursor)
      const page2Res = await http.send(
        tenantHostA,
        "GET",
        `/api/announcements?limit=10&cursor=${page1.nextCursor}`,
        undefined,
        { cookie: teacherA.cookie },
      );
      expect(page2Res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page2 = page2Res.body as any;
      expect(page2.items.length).toBe(10);
      expect(page2.nextCursor).not.toBeNull();

      // Fetch page 3 (limit 10, cursor)
      const page3Res = await http.send(
        tenantHostA,
        "GET",
        `/api/announcements?limit=10&cursor=${page2.nextCursor}`,
        undefined,
        { cookie: teacherA.cookie },
      );
      expect(page3Res.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const page3 = page3Res.body as any;
      expect(page3.items.length).toBeGreaterThan(0);

      // Verify no duplicate IDs across page 1 and page 2
      const ids1 = new Set(page1.items.map((i: { id: string }) => i.id));
      for (const item of page2.items) {
        expect(ids1.has(item.id)).toBe(false);
      }

      // Verify chronological ordering (descending)
      const allFetched = [...page1.items, ...page2.items, ...page3.items];
      for (let i = 0; i < allFetched.length - 1; i++) {
        const curr = new Date(allFetched[i].publishedAt).getTime();
        const next = new Date(allFetched[i + 1].publishedAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(next);
      }
    });
  });
});
