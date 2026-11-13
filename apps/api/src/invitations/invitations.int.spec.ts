import { randomUUID } from "node:crypto";
import { clearTestMailbox, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "InviteTestPassword123!";
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

beforeEach(() => {
  clearTestMailbox();
});

type Tenant = { id: string; slug: string };
const host = (t: Tenant) => `${t.slug}.localhost`;
const as = (t: Tenant, cookie: string, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body, { cookie });
const anon = (t: Tenant, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body);

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const auditOf = (tenantId: string, targetId: string) =>
  systemPrisma.auditLog.findMany({ where: { tenantId, targetId } });

describe("Invitations API (Integration)", () => {
  describe("POST /api/invitations (Creation)", () => {
    it("allows teacher and assistant to create an invitation, sends email, writes audit log", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");

      // Create a course in tenant t
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Tajweed Basics" },
      });

      // Teacher creates invitation
      const inviteEmail = `student-${randomUUID().slice(0, 8)}@example.com`;
      const res = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });

      expect(res.status).toBe(201);
      const body = res.body as { id: string; email: string; token: string; courseIds: string[] };
      expect(body.email).toBe(inviteEmail.toLowerCase());
      expect(body.courseIds).toEqual([course.id]);
      expect(body.token).toBeDefined();

      // Check email was sent
      const sentEmail = getLastSentEmail(inviteEmail);
      expect(sentEmail).toBeDefined();
      expect(sentEmail?.html).toContain(body.token);
      expect(sentEmail?.html).toContain("Tajweed Basics");

      // Check audit log
      const [audit] = await auditOf(t.id, body.id);
      expect(audit).toMatchObject({
        action: "invitation.create",
        actorUserId: teacher.user.id,
        targetType: "invitation",
      });

      // Assistant creates invitation for a second student
      const inviteEmail2 = `student2-${randomUUID().slice(0, 8)}@example.com`;
      const res2 = await as(t, assistant.cookie, "POST", "/invitations", {
        email: inviteEmail2,
        courseIds: [course.id],
      });
      expect(res2.status).toBe(201);
    });

    it("rejects duplicate active invitation with 409 INVITATION_ALREADY_EXISTS", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Fiqh Basics" },
      });

      const inviteEmail = `dup-${randomUUID().slice(0, 8)}@example.com`;
      await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });

      // Second attempt while pending
      const res = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });
      expect(res.status).toBe(409);
      expect(reasonOf(res.body)).toBe("INVITATION_ALREADY_EXISTS");
    });

    it("rejects non-existent or foreign courses with 400 INVALID_COURSES", async () => {
      const t = await fx.tenant();
      const otherTenant = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      // Course belonging to another tenant
      const otherCourse = await systemPrisma.course.create({
        data: { tenantId: otherTenant.id, title: "Other Academy Course" },
      });

      const res = await as(t, teacher.cookie, "POST", "/invitations", {
        email: "test@example.com",
        courseIds: [otherCourse.id],
      });
      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("INVALID_COURSES");
    });

    it("students receive 403 ROLE_FORBIDDEN on creation", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const student = await fx.studentLogin(t, user.email);
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course 1" },
      });

      const res = await as(t, student.cookies, "POST", "/invitations", {
        email: "someone@example.com",
        courseIds: [course.id],
      });
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    });
  });

  describe("GET /api/invitations (Listing & Filters)", () => {
    it("lists invitations with status filter and cursor pagination without leaking tokens", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Tafsir" },
      });

      // Create 3 invitations
      const e1 = `e1-${randomUUID().slice(0, 8)}@example.com`;
      const e2 = `e2-${randomUUID().slice(0, 8)}@example.com`;
      const e3 = `e3-${randomUUID().slice(0, 8)}@example.com`;

      const r1 = await as(t, teacher.cookie, "POST", "/invitations", {
        email: e1,
        courseIds: [course.id],
      });
      const r2 = await as(t, teacher.cookie, "POST", "/invitations", {
        email: e2,
        courseIds: [course.id],
      });
      const r3 = await as(t, teacher.cookie, "POST", "/invitations", {
        email: e3,
        courseIds: [course.id],
      });

      const _id1 = (r1.body as { id: string }).id;
      const id2 = (r2.body as { id: string }).id;
      const _id3 = (r3.body as { id: string }).id;

      // Revoke r2
      await as(t, teacher.cookie, "POST", `/invitations/${id2}/revoke`);

      // List all
      const listAll = await as(t, teacher.cookie, "GET", "/invitations");
      expect(listAll.status).toBe(200);
      const itemsAll = (
        listAll.body as { items: Array<{ id: string; token?: string; tokenHash?: string }> }
      ).items;
      expect(itemsAll.length).toBe(3);
      // Ensure token and tokenHash are NEVER exposed in list
      for (const item of itemsAll) {
        expect(item.token).toBeUndefined();
        expect(item.tokenHash).toBeUndefined();
      }

      // Filter by status=revoked
      const listRevoked = await as(t, teacher.cookie, "GET", "/invitations?status=revoked");
      expect(listRevoked.status).toBe(200);
      const itemsRevoked = (listRevoked.body as { items: Array<{ id: string }> }).items;
      expect(itemsRevoked.length).toBe(1);
      expect(itemsRevoked[0]?.id).toBe(id2);

      // Filter by status=pending
      const listPending = await as(t, teacher.cookie, "GET", "/invitations?status=pending");
      expect(listPending.status).toBe(200);
      const itemsPending = (listPending.body as { items: Array<{ id: string }> }).items;
      expect(itemsPending.length).toBe(2);

      // Pagination test with limit=1
      const page1 = await as(t, teacher.cookie, "GET", "/invitations?limit=1");
      expect(page1.status).toBe(200);
      const p1Body = page1.body as { items: Array<{ id: string }>; nextCursor: string | null };
      expect(p1Body.items.length).toBe(1);
      expect(p1Body.nextCursor).toBeDefined();

      const page2 = await as(
        t,
        teacher.cookie,
        "GET",
        `/invitations?limit=1&cursor=${p1Body.nextCursor}`,
      );
      expect(page2.status).toBe(200);
      const p2Body = page2.body as { items: Array<{ id: string }> };
      expect(p2Body.items.length).toBe(1);
      expect(p2Body.items[0]?.id).not.toBe(p1Body.items[0]?.id);
    });
  });

  describe("POST /api/invitations/:id/resend & revoke", () => {
    it("resends invitation: rotates token, resets expiration, sends new email, logs audit", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Arabic Language" },
      });

      const inviteEmail = `resend-${randomUUID().slice(0, 8)}@example.com`;
      const created = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });
      const originalToken = (created.body as { id: string; token: string }).token;
      const invId = (created.body as { id: string }).id;

      clearTestMailbox();

      const resendRes = await as(t, teacher.cookie, "POST", `/invitations/${invId}/resend`);
      expect(resendRes.status).toBe(200);
      const newToken = (resendRes.body as { token: string }).token;
      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(originalToken);

      // Old token must fail check now
      const checkOld = await anon(t, "GET", `/invitations/check?token=${originalToken}`);
      expect(checkOld.status).toBe(404);

      // New token passes check
      const checkNew = await anon(t, "GET", `/invitations/check?token=${newToken}`);
      expect(checkNew.status).toBe(200);

      // Audit log
      const audits = await auditOf(t.id, invId);
      const resendAudit = audits.find((a) => a.action === "invitation.resend");
      expect(resendAudit).toBeDefined();
      expect(resendAudit?.actorUserId).toBe(teacher.user.id);
    });

    it("revokes invitation: sets revokedAt, burns check with 410, logs audit", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Hadith Studies" },
      });

      const inviteEmail = `revoke-${randomUUID().slice(0, 8)}@example.com`;
      const created = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });
      const { id: invId, token } = created.body as { id: string; token: string };

      const revokeRes = await as(t, teacher.cookie, "POST", `/invitations/${invId}/revoke`);
      expect(revokeRes.status).toBe(200);

      // Check returns 410 INVITATION_REVOKED
      const checkRes = await anon(t, "GET", `/invitations/check?token=${token}`);
      expect(checkRes.status).toBe(410);
      expect(reasonOf(checkRes.body)).toBe("INVITATION_REVOKED");

      // Cannot resend a revoked invitation
      const resendRes = await as(t, teacher.cookie, "POST", `/invitations/${invId}/resend`);
      expect(resendRes.status).toBe(400);
      expect(reasonOf(resendRes.body)).toBe("INVITATION_REVOKED");

      // Cannot revoke again
      const revokeAgain = await as(t, teacher.cookie, "POST", `/invitations/${invId}/revoke`);
      expect(revokeAgain.status).toBe(400);
    });
  });

  describe("GET /api/invitations/check (Scanner-safe Validation)", () => {
    it("is strictly idempotent and read-only: calling 5 times does not consume token", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Quran Memorization" },
      });

      const inviteEmail = `scanner-${randomUUID().slice(0, 8)}@example.com`;
      const created = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });
      const { token } = created.body as { token: string };

      for (let i = 0; i < 5; i++) {
        const checkRes = await anon(t, "GET", `/invitations/check?token=${token}`);
        expect(checkRes.status).toBe(200);
        expect(checkRes.body).toMatchObject({
          valid: true,
          email: inviteEmail.toLowerCase(),
          tenant: { id: t.id, slug: t.slug },
          courses: [{ id: course.id, title: "Quran Memorization" }],
        });
      }

      // Check DB: invitation is still pending and unredeemed
      const row = await systemPrisma.invitation.findFirst({
        where: { email: inviteEmail.toLowerCase() },
      });
      expect(row?.redeemedAt).toBeNull();
    });

    it("returns 410 INVITATION_EXPIRED for expired tokens", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course X" },
      });

      const inviteEmail = `expired-${randomUUID().slice(0, 8)}@example.com`;
      const created = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });
      const { id: invId, token } = created.body as { id: string; token: string };

      // Manually backdate expiresAt in DB
      await systemPrisma.invitation.update({
        where: { id: invId },
        data: { expiresAt: new Date(Date.now() - 3600_000) },
      });

      const res = await anon(t, "GET", `/invitations/check?token=${token}`);
      expect(res.status).toBe(410);
      expect(reasonOf(res.body)).toBe("INVITATION_EXPIRED");
    });
  });

  describe("POST /api/register (New Student Registration & Implicit Email Verification)", () => {
    it("registers new student with guardian consent, verifies email, creates membership and enrollments", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course1 = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course Alpha" },
      });
      const course2 = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course Beta" },
      });

      const inviteEmail = `newstudent-${randomUUID().slice(0, 8)}@example.com`;
      const created = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course1.id, course2.id],
      });
      const { id: invId, token } = created.body as { id: string; token: string };

      // Minor registration without guardian consent fails validation (400)
      const minorFail = await anon(t, "POST", "/register", {
        token,
        name: "Young Student",
        password: "ValidPassword123!",
        isMinor: true,
        guardianConsent: false,
      });
      expect(minorFail.status).toBe(400);

      // Minor registration WITH guardian consent succeeds (201)
      const registerRes = await anon(t, "POST", "/register", {
        token,
        name: "Young Student",
        password: "ValidPassword123!",
        isMinor: true,
        guardianConsent: true,
      });
      expect(registerRes.status).toBe(201);
      const regBody = registerRes.body as { userId: string; membershipId: string; email: string };
      expect(regBody.email).toBe(inviteEmail.toLowerCase());

      // Verify user created with emailVerified: true (implicit verification)
      const user = await systemPrisma.user.findUniqueOrThrow({ where: { id: regBody.userId } });
      expect(user.emailVerified).toBe(true);

      // Verify membership with guardianConsentAt
      const membership = await systemPrisma.membership.findUniqueOrThrow({
        where: { id: regBody.membershipId },
      });
      expect(membership.role).toBe("student");
      expect(membership.guardianConsentAt).not.toBeNull();

      // Verify enrollments created
      const enrollments = await systemPrisma.enrollment.findMany({
        where: { membershipId: membership.id },
      });
      expect(enrollments.length).toBe(2);
      expect(enrollments.every((e) => e.status === "active")).toBe(true);
      expect(enrollments.every((e) => e.source === "invitation")).toBe(true);

      // Verify invitation marked redeemed
      const inv = await systemPrisma.invitation.findUniqueOrThrow({ where: { id: invId } });
      expect(inv.redeemedAt).not.toBeNull();
      expect(inv.redeemedBy).toBe(user.id);

      // Verify audit log
      const audits = await auditOf(t.id, invId);
      const redeemAudit = audits.find((a) => a.action === "invitation.redeem");
      expect(redeemAudit).toBeDefined();
      expect(redeemAudit?.actorUserId).toBe(user.id);

      // Token check now returns 410 INVITATION_ALREADY_REDEEMED
      const checkAfter = await anon(t, "GET", `/invitations/check?token=${token}`);
      expect(checkAfter.status).toBe(410);
      expect(reasonOf(checkAfter.body)).toBe("INVITATION_ALREADY_REDEEMED");

      // Registering again with the redeemed token fails with 409 INVITATION_NOT_AVAILABLE
      const secondRegister = await anon(t, "POST", "/register", {
        token,
        name: "Young Student",
        password: "ValidPassword123!",
      });
      expect(secondRegister.status).toBe(409);
      expect(reasonOf(secondRegister.body)).toBe("INVITATION_NOT_AVAILABLE");
    });
  });

  describe("POST /api/invitations/accept (Existing User Acceptance)", () => {
    it("existing user accepts invitation when email matches strictly, rejects mismatch with 403", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Islamic History" },
      });

      // Create an existing student user on another tenant
      const otherTenant = await fx.tenant();
      const { user: existingStudentUser } = await fx.member(otherTenant.id, "student");
      const { user: wrongStudentUser } = await fx.member(otherTenant.id, "student");

      const wrongLogin = await fx.studentLogin(otherTenant, wrongStudentUser.email);
      const matchingLogin = await fx.studentLogin(otherTenant, existingStudentUser.email);

      // Invite sent to existingStudentUser.email
      const created = await as(t, teacher.cookie, "POST", "/invitations", {
        email: existingStudentUser.email,
        courseIds: [course.id],
      });
      const { id: invId, token } = created.body as { id: string; token: string };

      // 1. Wrong student tries to accept -> 403 EMAIL_MISMATCH
      const wrongRes = await as(t, wrongLogin.cookies, "POST", "/invitations/accept", { token });
      expect(wrongRes.status).toBe(403);
      expect(reasonOf(wrongRes.body)).toBe("EMAIL_MISMATCH");

      // 2. Matching student signs in and accepts -> 200 OK
      const acceptRes = await as(t, matchingLogin.cookies, "POST", "/invitations/accept", {
        token,
      });
      expect(acceptRes.status).toBe(200);
      const acceptBody = acceptRes.body as { membershipId: string };

      // Membership created on tenant t
      const membership = await systemPrisma.membership.findUniqueOrThrow({
        where: { id: acceptBody.membershipId },
      });
      expect(membership.tenantId).toBe(t.id);
      expect(membership.userId).toBe(existingStudentUser.id);
      expect(membership.role).toBe("student");

      // Enrolled in course
      const enrollment = await systemPrisma.enrollment.findUniqueOrThrow({
        where: { membershipId_courseId: { membershipId: membership.id, courseId: course.id } },
      });
      expect(enrollment.status).toBe("active");

      // Invitation marked redeemed
      const inv = await systemPrisma.invitation.findUniqueOrThrow({ where: { id: invId } });
      expect(inv.redeemedAt).not.toBeNull();
      expect(inv.redeemedBy).toBe(existingStudentUser.id);

      // Audit log recorded
      const audits = await auditOf(t.id, invId);
      const acceptAudit = audits.find((a) => a.action === "invitation.accept");
      expect(acceptAudit).toBeDefined();
      expect(acceptAudit?.actorUserId).toBe(existingStudentUser.id);
    });

    it("requires authentication: unauthenticated request returns 401", async () => {
      const t = await fx.tenant();
      const res = await anon(t, "POST", "/invitations/accept", { token: "some-dummy-token-12345" });
      expect(res.status).toBe(401);
    });
  });

  describe("Concurrency & Race Condition Verification (FR-A02)", () => {
    it("5 concurrent redemption attempts on the same token result in exactly 1 success and 4 409s", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Concurrency Course" },
      });

      const inviteEmail = `race-${randomUUID().slice(0, 8)}@example.com`;
      const created = await as(t, teacher.cookie, "POST", "/invitations", {
        email: inviteEmail,
        courseIds: [course.id],
      });
      const { id: invId, token } = created.body as { id: string; token: string };

      // Launch 5 parallel registration attempts simultaneously
      const attempts = await Promise.all(
        Array.from({ length: 5 }).map((_, i) =>
          anon(t, "POST", "/register", {
            token,
            name: `Competitor ${i}`,
            password: "RacePassword123!",
          }),
        ),
      );

      const successful = attempts.filter((r) => r.status === 201);
      const conflicted = attempts.filter((r) => r.status === 409);

      expect(successful.length).toBe(1);
      expect(conflicted.length).toBe(4);
      for (const conf of conflicted) {
        expect(reasonOf(conf.body)).toBe("INVITATION_NOT_AVAILABLE");
      }

      // In database: exactly one user redeemed the invitation
      const inv = await systemPrisma.invitation.findUniqueOrThrow({ where: { id: invId } });
      expect(inv.redeemedAt).not.toBeNull();
      expect(inv.redeemedBy).toBeDefined();

      // Only one membership created for this email in tenant t
      const memberships = await systemPrisma.membership.findMany({
        where: { tenantId: t.id, user: { email: inviteEmail.toLowerCase() } },
      });
      expect(memberships.length).toBe(1);
    });
  });

  describe("Multi-tenancy Isolation", () => {
    it("tenant A staff cannot view or manipulate tenant B's invitations", async () => {
      const tenantA = await fx.tenant();
      const tenantB = await fx.tenant();

      const teacherA = await fx.staffLogin(tenantA, "teacher");
      const teacherB = await fx.staffLogin(tenantB, "teacher");

      const courseB = await systemPrisma.course.create({
        data: { tenantId: tenantB.id, title: "Tenant B Course" },
      });

      // Tenant B creates an invitation
      const inviteB = await as(tenantB, teacherB.cookie, "POST", "/invitations", {
        email: `isolated-${randomUUID().slice(0, 8)}@example.com`,
        courseIds: [courseB.id],
      });
      const invBId = (inviteB.body as { id: string }).id;

      // Teacher A tries to list invitations -> Tenant B's invitation is not in list
      const listA = await as(tenantA, teacherA.cookie, "GET", "/invitations");
      const itemsA = (listA.body as { items: Array<{ id: string }> }).items;
      expect(itemsA.some((item) => item.id === invBId)).toBe(false);

      // Teacher A tries to resend Tenant B's invitation -> 404
      const resendRes = await as(tenantA, teacherA.cookie, "POST", `/invitations/${invBId}/resend`);
      expect(resendRes.status).toBe(404);

      // Teacher A tries to revoke Tenant B's invitation -> 404
      const revokeRes = await as(tenantA, teacherA.cookie, "POST", `/invitations/${invBId}/revoke`);
      expect(revokeRes.status).toBe(404);
    });
  });
});
