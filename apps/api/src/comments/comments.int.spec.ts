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
let lesson1Id: string;
let lesson2Id: string;

let teacherA: { userId: string; email: string; cookie: string };
let enrolledStudent: { userId: string; email: string; cookie: string; membershipId: string };
let unenrolledStudent: { userId: string; email: string; cookie: string; membershipId: string };
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
  const email = `comm-teacher-${randomUUID().slice(0, 8)}@example.com`;
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

  const cookie = toCookieHeader(signIn.headers);
  return { userId: signUp.user.id, email, cookie };
}

async function createAuthenticatedStudent(opts: {
  name: string;
  tenantId: string;
  tenantHost: string;
}): Promise<{ userId: string; email: string; cookie: string; membershipId: string }> {
  const email = `comm-student-${randomUUID().slice(0, 8)}@example.com`;
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

describe("Lesson Q&A Comments API (Integration)", () => {
  beforeAll(async () => {
    http = await createHttpTestApp(AppModule);

    // 1. Setup Tenant A
    tenantSlugA = `comm-t-a-${randomUUID().slice(0, 8)}`;
    tenantHostA = `${tenantSlugA}.localhost`;
    const tA = await systemPrisma.tenant.create({
      data: { name: `Tenant A ${tenantSlugA}`, slug: tenantSlugA },
    });
    tenantIdA = tA.id;

    // 2. Setup Tenant B
    tenantSlugB = `comm-t-b-${randomUUID().slice(0, 8)}`;
    tenantHostB = `${tenantSlugB}.localhost`;
    const tB = await systemPrisma.tenant.create({
      data: { name: `Tenant B ${tenantSlugB}`, slug: tenantSlugB },
    });
    tenantIdB = tB.id;

    // 3. Setup Course 1 & Lesson 1 in Tenant A
    const c1 = await systemPrisma.course.create({
      data: { tenantId: tenantIdA, title: "Course 1 Tajweed", status: "published" },
    });
    course1Id = c1.id;

    const l1 = await systemPrisma.contentItem.create({
      data: {
        tenantId: tenantIdA,
        courseId: course1Id,
        kind: "lecture",
        title: "Lesson 1: Intro to Tajweed",
        publishedAt: new Date(),
        sortOrder: 0,
        depth: 0,
      },
    });
    lesson1Id = l1.id;

    // 4. Setup Course 2 & Lesson 2 in Tenant A
    const c2 = await systemPrisma.course.create({
      data: { tenantId: tenantIdA, title: "Course 2 Fiqh", status: "published" },
    });
    course2Id = c2.id;

    const l2 = await systemPrisma.contentItem.create({
      data: {
        tenantId: tenantIdA,
        courseId: course2Id,
        kind: "lecture",
        title: "Lesson 2: Intro to Fiqh",
        publishedAt: new Date(),
        sortOrder: 0,
        depth: 0,
      },
    });
    lesson2Id = l2.id;

    // 5. Setup Users in Tenant A
    teacherA = await createAuthenticatedTeacher({
      name: "Teacher Omar",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    enrolledStudent = await createAuthenticatedStudent({
      name: "Enrolled Student Ali",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    unenrolledStudent = await createAuthenticatedStudent({
      name: "Unenrolled Student Zaid",
      tenantId: tenantIdA,
      tenantHost: tenantHostA,
    });

    // 6. Enroll Ali in Course 1 only
    await systemPrisma.enrollment.create({
      data: {
        tenantId: tenantIdA,
        courseId: course1Id,
        membershipId: enrolledStudent.membershipId,
        source: "manual",
        grantedBy: teacherA.userId,
        status: "active",
      },
    });

    // 7. Setup Student in Tenant B
    studentB = await createAuthenticatedStudent({
      name: "Student B",
      tenantId: tenantIdB,
      tenantHost: tenantHostB,
    });
  });

  afterAll(async () => {
    await http.close();

    // Clean up tenant A and B (cascades all tenant-owned rows)
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

  describe("post and reply (Gate G2)", () => {
    let topLevelCommentId: string;

    it("enrolled student can post top-level question on a lesson and receives created comment with author info", async () => {
      const res = await http.send(
        tenantHostA,
        "POST",
        `/api/content-items/${lesson1Id}/comments`,
        {
          body: "What is the difference between Idgham with and without Ghunnah?",
        },
        { cookie: enrolledStudent.cookie },
      );

      expect(res.status).toBe(201);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.body as any;
      expect(data.id).toBeDefined();
      expect(data.body).toBe("What is the difference between Idgham with and without Ghunnah?");
      expect(data.contentItemId).toBe(lesson1Id);
      expect(data.parentId).toBeNull();
      expect(data.author.name).toBe("Enrolled Student Ali");
      expect(data.author.role).toBe("student");

      topLevelCommentId = data.id;
    });

    it("teacher and student can post threaded replies referencing parentId", async () => {
      // Teacher replies to student
      const replyRes = await http.send(
        tenantHostA,
        "POST",
        `/api/content-items/${lesson1Id}/comments`,
        {
          body: "Ghunnah is held for two counts with letters Yanmoo (ي, ن, م, و).",
          parentId: topLevelCommentId,
        },
        { cookie: teacherA.cookie },
      );

      expect(replyRes.status).toBe(201);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const replyData = replyRes.body as any;
      expect(replyData.parentId).toBe(topLevelCommentId);
      expect(replyData.author.name).toBe("Teacher Omar");
      expect(replyData.author.role).toBe("teacher");

      // Student posts follow-up reply
      const followUpRes = await http.send(
        tenantHostA,
        "POST",
        `/api/content-items/${lesson1Id}/comments`,
        {
          body: "Thank you Sheikh, that is very clear!",
          parentId: topLevelCommentId,
        },
        { cookie: enrolledStudent.cookie },
      );

      expect(followUpRes.status).toBe(201);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const followUpData = followUpRes.body as any;
      expect(followUpData.parentId).toBe(topLevelCommentId);

      // Verify list returns all 3 comments
      const listRes = await http.send(
        tenantHostA,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: enrolledStudent.cookie },
      );

      expect(listRes.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = listRes.body as any;
      expect(list.items.length).toBe(3);
    });

    it("rejects reply referencing parent from different lesson or invalid parent", async () => {
      const res = await http.send(
        tenantHostA,
        "POST",
        `/api/content-items/${lesson2Id}/comments`,
        {
          body: "Reply pointing to wrong lesson parent",
          parentId: topLevelCommentId, // Belongs to lesson 1!
        },
        { cookie: teacherA.cookie },
      );

      expect(res.status).toBe(400);
    });
  });

  describe("enrollment fencing (Gate G3)", () => {
    // Step 10.3 (audit lead comments.service.ts:student-qa-skips-publish-gating).
    it("enrolled student cannot read or post Q&A on an unpublished lesson (404)", async () => {
      const draft = await systemPrisma.contentItem.create({
        data: { tenantId: tenantIdA, courseId: course1Id, kind: "lecture", title: "Draft lesson", sortOrder: 9, depth: 0 },
      });
      const get = await http.send(tenantHostA, "GET", `/api/content-items/${draft.id}/comments`, undefined, { cookie: enrolledStudent.cookie });
      expect(get.status).toBe(404);
      const post = await http.send(tenantHostA, "POST", `/api/content-items/${draft.id}/comments`, { body: "hi" }, { cookie: enrolledStudent.cookie });
      expect(post.status).toBe(404);
    });

    it("unenrolled student cannot post comment on a lesson (403 Forbidden)", async () => {
      // Unenrolled student tries to post on Lesson 1
      const res = await http.send(
        tenantHostA,
        "POST",
        `/api/content-items/${lesson1Id}/comments`,
        {
          body: "I am not enrolled, can I ask a question?",
        },
        { cookie: unenrolledStudent.cookie },
      );

      expect(res.status).toBe(403);
    });

    it("unenrolled student cannot list comments on a lesson (403 Forbidden)", async () => {
      const res = await http.send(
        tenantHostA,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: unenrolledStudent.cookie },
      );

      expect(res.status).toBe(403);
    });

    it("cross-tenant isolation: student in Tenant B cannot view or post to Tenant A lessons (403/404)", async () => {
      const postRes = await http.send(
        tenantHostB,
        "POST",
        `/api/content-items/${lesson1Id}/comments`,
        {
          body: "Cross-tenant intrusion attempt",
        },
        { cookie: studentB.cookie },
      );
      // Handled as 404 (content item not in Tenant B)
      expect(postRes.status).toBe(404);

      const getRes = await http.send(
        tenantHostB,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: studentB.cookie },
      );
      expect(getRes.status).toBe(404);
    });
  });

  describe("moderation (Gate G4)", () => {
    let commentToModerateId: string;

    beforeAll(async () => {
      // Create a student comment to be moderated
      const res = await http.send(
        tenantHostA,
        "POST",
        `/api/content-items/${lesson1Id}/comments`,
        {
          body: "Is this question appropriate?",
        },
        { cookie: enrolledStudent.cookie },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      commentToModerateId = (res.body as any).id;
    });

    it("staff can hide a comment with audit log; hidden comment is invisible to students but visible to staff", async () => {
      // 1. Staff hides the comment
      const hideRes = await http.send(
        tenantHostA,
        "PATCH",
        `/api/comments/${commentToModerateId}`,
        { hidden: true },
        { cookie: teacherA.cookie },
      );

      expect(hideRes.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((hideRes.body as any).hiddenAt).not.toBeNull();

      // 2. Audit log recorded
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: tenantIdA,
          action: "comment.hide",
          targetId: commentToModerateId,
        },
      });
      expect(audit).not.toBeNull();
      expect(audit?.actorUserId).toBe(teacherA.userId);

      // 3. Student list: hidden comment is completely INVISIBLE
      const studentListRes = await http.send(
        tenantHostA,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: enrolledStudent.cookie },
      );
      expect(studentListRes.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const studentItems = (studentListRes.body as any).items;
      expect(studentItems.some((c: { id: string }) => c.id === commentToModerateId)).toBe(false);

      // 4. Staff list: hidden comment is VISIBLE
      const staffListRes = await http.send(
        tenantHostA,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: teacherA.cookie },
      );
      expect(staffListRes.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const staffItems = (staffListRes.body as any).items;
      const found = staffItems.find((c: { id: string }) => c.id === commentToModerateId);
      expect(found).toBeDefined();
      expect(found.hiddenAt).not.toBeNull();
    });

    it("staff can unhide a previously hidden comment with audit log; comment becomes visible again to students", async () => {
      // 1. Staff unhides the comment
      const unhideRes = await http.send(
        tenantHostA,
        "PATCH",
        `/api/comments/${commentToModerateId}`,
        { hidden: false },
        { cookie: teacherA.cookie },
      );

      expect(unhideRes.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((unhideRes.body as any).hiddenAt).toBeNull();

      // 2. Audit log recorded
      const audit = await systemPrisma.auditLog.findFirst({
        where: {
          tenantId: tenantIdA,
          action: "comment.unhide",
          targetId: commentToModerateId,
        },
      });
      expect(audit).not.toBeNull();

      // 3. Student list: comment is now VISIBLE again
      const studentListRes = await http.send(
        tenantHostA,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: enrolledStudent.cookie },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const studentItems = (studentListRes.body as any).items;
      expect(studentItems.some((c: { id: string }) => c.id === commentToModerateId)).toBe(true);
    });

    it("student cannot hide a comment (403 Forbidden)", async () => {
      const res = await http.send(
        tenantHostA,
        "PATCH",
        `/api/comments/${commentToModerateId}`,
        { hidden: true },
        { cookie: enrolledStudent.cookie },
      );

      expect(res.status).toBe(403);
    });

    it("author can edit their own comment body; other students cannot edit it (403 Forbidden)", async () => {
      // Author edits body
      const editRes = await http.send(
        tenantHostA,
        "PATCH",
        `/api/comments/${commentToModerateId}`,
        { body: "Updated comment body with clarified question." },
        { cookie: enrolledStudent.cookie },
      );

      expect(editRes.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((editRes.body as any).body).toBe("Updated comment body with clarified question.");

      // Other student tries to edit
      const unauthorizedEdit = await http.send(
        tenantHostA,
        "PATCH",
        `/api/comments/${commentToModerateId}`,
        { body: "Malicious override" },
        { cookie: unenrolledStudent.cookie },
      );
      expect(unauthorizedEdit.status).toBe(403);
    });

    it("author and staff can delete a comment; deleted comment is excluded from both student and staff lists", async () => {
      // Staff deletes the comment
      const deleteRes = await http.send(
        tenantHostA,
        "DELETE",
        `/api/comments/${commentToModerateId}`,
        undefined,
        { cookie: teacherA.cookie },
      );

      expect(deleteRes.status).toBe(200);

      // Verify soft deletion in database
      const dbRow = await systemPrisma.comment.findUnique({
        where: { id: commentToModerateId },
      });
      expect(dbRow?.deletedAt).not.toBeNull();

      // Student list: comment is excluded
      const studentList = await http.send(
        tenantHostA,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: enrolledStudent.cookie },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((studentList.body as any).items.some((c: { id: string }) => c.id === commentToModerateId)).toBe(false);

      // Staff list: deleted comment is ALSO excluded
      const staffList = await http.send(
        tenantHostA,
        "GET",
        `/api/content-items/${lesson1Id}/comments`,
        undefined,
        { cookie: teacherA.cookie },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((staffList.body as any).items.some((c: { id: string }) => c.id === commentToModerateId)).toBe(false);
    });
  });
});
