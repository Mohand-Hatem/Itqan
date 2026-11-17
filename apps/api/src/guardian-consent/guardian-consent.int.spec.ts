// 10R.7 (FR-A06, ADR-014): guardian consent once per person. The gate closes content, progress,
// comments and every attempt route for a minor without consent; electronic (guardian email link)
// and offline (signed form by reference) consent open it in every academy; withdrawal closes it;
// old checkbox rows never count; guardian details stay with the recording academy.
import { randomUUID } from "node:crypto";
import { DEVICE_COOKIE_NAME, clearTestMailbox, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, CONSENT_POLICY_VERSION, GuardianConsentReason } from "@itqan/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("ConsentTestPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
const adminIds: string[] = [];

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});
beforeEach(() => clearTestMailbox());

afterAll(async () => {
  await http?.close();
  await systemPrisma.auditLog.deleteMany({ where: { actorUserId: { in: adminIds } } });
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

type Id = { id: string };
const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;
const GATED = AccessReasonCode.GUARDIAN_CONSENT_REQUIRED;
const guardian = (email = `parent-${randomUUID().slice(0, 8)}@example.com`) => ({
  guardianName: "Parent Person",
  relationship: "parent",
  guardianEmail: email,
});

/** An academy with a published course, one item, one open quiz, and an enrolled student. */
async function academy(opts: { minor?: boolean; studentUserId?: string } = {}) {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const send = (cookie: string, method: string, path: string, body?: unknown) =>
    http.send(`${t.slug}.localhost`, method, `/api${path}`, body, { cookie });
  const asTeacher = (method: string, path: string, body?: unknown) => send(teacher.cookie, method, path, body);
  const courseId = ((await asTeacher("POST", "/courses", { title: "Course" })).body as Id).id;
  await asTeacher("PATCH", `/courses/${courseId}`, { status: "published" });
  const item = (await asTeacher("POST", "/content-items", { courseId, parentId: null, kind: "folder", title: "Unit" }))
    .body as Id;
  await asTeacher("PATCH", `/content-items/${item.id}`, { published: true });
  const quiz = await systemPrisma.quiz.create({
    data: {
      tenantId: t.id,
      courseId,
      title: "Quiz",
      durationMin: 10,
      passMark: 50,
      opensAt: new Date(Date.now() - 60_000),
      publishedAt: new Date(),
    },
  });

  const student = opts.studentUserId
    ? {
        user: await systemPrisma.user.findUniqueOrThrow({ where: { id: opts.studentUserId } }),
        membership: await systemPrisma.membership.create({
          data: { tenantId: t.id, userId: opts.studentUserId, role: "student" },
        }),
      }
    : await fx.member(t.id, "student");
  if (opts.minor) await systemPrisma.user.update({ where: { id: student.user.id }, data: { isMinor: true } });
  await systemPrisma.enrollment.create({
    data: { tenantId: t.id, membershipId: student.membership.id, courseId, source: "manual", grantedBy: teacher.user.id },
  });
  return { t, teacher, student, courseId, itemId: item.id, quizId: quiz.id, send, asTeacher };
}

/** Signs the student in on this academy (reusing a device cookie for a second academy). */
async function signIn(a: Awaited<ReturnType<typeof academy>>, deviceCookie?: string) {
  const login = await fx.studentLogin(a.t, a.student.user.email, deviceCookie);
  expect(login.status).toBe(200);
  return {
    cookie: login.cookies,
    device: login.cookies.split("; ").find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`)),
    as: (method: string, path: string, body?: unknown) => a.send(login.cookies, method, path, body),
  };
}

describe("the consent gate (FR-A06)", () => {
  it("closes content, progress, comments and every attempt route for a minor without consent", async () => {
    const a = await academy({ minor: true });
    const s = await signIn(a);
    const fakeAttempt = randomUUID();

    for (const [method, path, body] of [
      ["GET", `/courses/${a.courseId}/access`],
      ["GET", `/courses/${a.courseId}/tree`],
      ["GET", `/content-items/${a.itemId}/access`],
      ["GET", `/courses/${a.courseId}/progress`],
      ["PUT", `/progress/${a.itemId}`, { completed: true }],
      ["GET", `/content-items/${a.itemId}/comments`],
      ["POST", `/quizzes/${a.quizId}/attempts`],
      ["GET", `/attempts/${fakeAttempt}`],
      ["PUT", `/attempts/${fakeAttempt}/answers/${randomUUID()}`, { selectedOptionIds: [] }],
      ["GET", `/attempts/${fakeAttempt}/answers`],
      ["POST", `/attempts/${fakeAttempt}/submit`],
      ["GET", `/attempts/${fakeAttempt}/review`],
    ] as const) {
      const res = await s.as(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(reasonOf(res.body), `${method} ${path}`).toBe(GATED);
    }

    // The student still signs in and sees why (no other change).
    const me = await s.as("GET", "/me");
    expect(me.status).toBe(200);
    expect((me.body as { user: { guardianConsent: string } }).user.guardianConsent).toBe("required");
  });

  it("leaves adults alone and never counts an old checkbox row", async () => {
    const adult = await academy();
    expect((await (await signIn(adult)).as("GET", `/courses/${adult.courseId}/tree`)).status).toBe(200);

    const minor = await academy({ minor: true });
    await systemPrisma.guardianConsent.create({
      data: {
        userId: minor.student.user.id,
        status: "given",
        method: "legacy_checkbox",
        obtainedAt: new Date(),
        recordedTenantId: minor.t.id,
        evidenceReference: "memberships.guardian_consent_at",
      },
    });
    const res = await (await signIn(minor)).as("GET", `/courses/${minor.courseId}/tree`);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(GATED);
  });
});

describe("electronic consent (guardian email link)", () => {
  it("lets the student ask, the guardian confirm once, and opens content in every academy", async () => {
    const a = await academy({ minor: true });
    const s = await signIn(a);

    const same = await s.as("POST", "/me/guardian-consent/request", guardian(a.student.user.email));
    expect(same.status).toBe(400);
    expect(reasonOf(same.body)).toBe(GuardianConsentReason.GUARDIAN_EMAIL_SAME_AS_STUDENT);

    const g = guardian();
    const req = await s.as("POST", "/me/guardian-consent/request", g);
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ status: "pending" });
    expect(JSON.stringify(req.body)).not.toContain("token");
    const mail = getLastSentEmail(g.guardianEmail)!;
    expect(mail.type).toBe("guardian_consent");
    expect(mail.idempotencyKey).toMatch(new RegExp(`^guardian_consent:${(req.body as Id).id}:`));
    expect(new URL(mail.url!).host).toBe(`${a.t.slug}.localhost`);

    const check = await a.send("", "GET", `/guardian-consent/check?token=${mail.token}`);
    expect(check.status).toBe(200);
    expect(check.body).toMatchObject({ studentName: a.student.user.name, policyVersion: CONSENT_POLICY_VERSION });
    expect(((await s.as("GET", "/me")).body as { user: { guardianConsent: string } }).user.guardianConsent).toBe(
      "pending",
    );
    expect((await s.as("GET", `/courses/${a.courseId}/tree`)).status).toBe(403);

    const body = { token: mail.token, guardianName: "Parent Person", relationship: "parent", agree: true };
    expect((await a.send("", "POST", "/guardian-consent/confirm", { ...body, agree: false })).status).toBe(400);
    const ok = await a.send("", "POST", "/guardian-consent/confirm", body);
    expect(ok.status).toBe(200);
    const again = await a.send("", "POST", "/guardian-consent/confirm", body);
    expect(again.status).toBe(410);
    expect(reasonOf(again.body)).toBe(GuardianConsentReason.CONSENT_LINK_NOT_AVAILABLE);

    const row = await systemPrisma.guardianConsent.findFirstOrThrow({ where: { userId: a.student.user.id } });
    expect(row).toMatchObject({ status: "given", method: "electronic_email", policyVersion: CONSENT_POLICY_VERSION, tokenHash: null });
    expect(row.obtainedAt).not.toBeNull();
    expect((await s.as("GET", `/courses/${a.courseId}/tree`)).status).toBe(200);

    // Once per person: a second academy opens too, and asking again is refused.
    const b = await academy({ studentUserId: a.student.user.id });
    const sb = await signIn(b, s.device);
    expect((await sb.as("GET", `/courses/${b.courseId}/tree`)).status).toBe(200);
    const twice = await sb.as("POST", "/me/guardian-consent/request", guardian());
    expect(twice.status).toBe(409);
    expect(reasonOf(twice.body)).toBe(GuardianConsentReason.CONSENT_ALREADY_GIVEN);
  });

  it("rotates the link on each request and allows 3 emails per hour per student", async () => {
    const a = await academy({ minor: true });
    const path = `/students/${a.student.membership.id}/guardian-consent/request`;
    const g = guardian();
    const tokens: string[] = [];
    for (let i = 0; i < 3; i++) {
      expect((await a.asTeacher("POST", path, g)).status).toBe(201);
      tokens.push(getLastSentEmail(g.guardianEmail)!.token!);
    }
    expect(await systemPrisma.guardianConsent.count({ where: { userId: a.student.user.id } })).toBe(1);
    expect((await a.send("", "GET", `/guardian-consent/check?token=${tokens[0]}`)).status).toBe(410);
    expect((await a.send("", "GET", `/guardian-consent/check?token=${tokens[2]}`)).status).toBe(200);

    const limited = await a.asTeacher("POST", path, g);
    expect(limited.status).toBe(429);
    expect(reasonOf(limited.body)).toBe(GuardianConsentReason.CONSENT_REQUEST_LIMIT);
  });
});

describe("offline consent, withdrawal and visibility", () => {
  it("opens content from a signed form, shows details only to the recording academy and the super admin, and closes on withdrawal", async () => {
    const a = await academy({ minor: true });
    const s = await signIn(a);
    const path = `/students/${a.student.membership.id}/guardian-consent`;
    const form = {
      guardianName: "Parent Person",
      relationship: "legal_guardian",
      obtainedOn: "2026-11-01",
      evidenceReference: "Signed form #114, office file 2026",
    };

    const future = await a.asTeacher("POST", path, { ...form, obtainedOn: "2099-01-01" });
    expect(future.status).toBe(400);
    const recorded = await a.asTeacher("POST", path, form);
    expect(recorded.status).toBe(201);
    expect(recorded.body).toMatchObject({ status: "given", method: "offline" });
    expect((await s.as("GET", `/courses/${a.courseId}/tree`)).status).toBe(200);

    type Profile = { profile: { isMinor: boolean; guardianConsent: { status: string; details: unknown } } };
    const own = (await a.asTeacher("GET", `/students/${a.student.membership.id}`)).body as Profile;
    expect(own.profile.isMinor).toBe(true);
    expect(own.profile.guardianConsent).toMatchObject({
      status: "given",
      details: { evidenceReference: form.evidenceReference, relationship: "legal_guardian" },
    });

    const b = await academy({ studentUserId: a.student.user.id });
    const other = (await b.asTeacher("GET", `/students/${b.student.membership.id}`)).body as Profile;
    expect(other.profile.guardianConsent).toMatchObject({ status: "given", details: null });

    const admin = await fx.staffLogin(b.t, "teacher", { superAdmin: true });
    adminIds.push(admin.user.id);
    const asAdmin = (await b.send(admin.cookie, "GET", `/students/${b.student.membership.id}`)).body as Profile;
    expect(asAdmin.profile.guardianConsent.details).toMatchObject({ evidenceReference: form.evidenceReference });

    // Any academy of the student may withdraw; content closes everywhere.
    const withdrawn = await b.asTeacher("POST", `/students/${b.student.membership.id}/guardian-consent/withdraw`);
    expect(withdrawn.status).toBe(200);
    const closed = await s.as("GET", `/courses/${a.courseId}/tree`);
    expect(closed.status).toBe(403);
    expect(reasonOf(closed.body)).toBe(GATED);
    const none = await b.asTeacher("POST", `/students/${b.student.membership.id}/guardian-consent/withdraw`);
    expect(none.status).toBe(404);
    expect(reasonOf(none.body)).toBe(GuardianConsentReason.NO_CONSENT_TO_WITHDRAW);

    const actions = await systemPrisma.auditLog.findMany({
      where: { targetType: "user", targetId: a.student.user.id },
      select: { action: true },
    });
    expect(actions.map((r) => r.action).sort()).toEqual(["guardian_consent.record_offline", "guardian_consent.withdraw"]);
  });

  it("keeps each academy to its own students and refuses consent for an adult", async () => {
    const a = await academy({ minor: true });
    const b = await academy();
    const form = { guardianName: "Parent Person", relationship: "parent", obtainedOn: "2026-11-01", evidenceReference: "Form 9" };

    // Tenant B's teacher cannot reach tenant A's membership.
    for (const path of ["", "/request", "/withdraw"]) {
      const res = await b.asTeacher("POST", `/students/${a.student.membership.id}/guardian-consent${path}`, path === "/request" ? guardian() : path ? undefined : form);
      expect(res.status, path).toBe(404);
    }
    expect(await systemPrisma.guardianConsent.count({ where: { userId: a.student.user.id } })).toBe(0);

    const adult = await b.asTeacher("POST", `/students/${b.student.membership.id}/guardian-consent`, form);
    expect(adult.status).toBe(409);
    expect(reasonOf(adult.body)).toBe(GuardianConsentReason.CONSENT_NOT_REQUIRED);

    // A student cannot use the staff routes.
    const s = await signIn(a);
    expect((await s.as("POST", `/students/${a.student.membership.id}/guardian-consent`, form)).status).toBe(403);
  });
});

describe("who sets isMinor", () => {
  it("is set at direct creation and changed afterwards by the super admin only (audited)", async () => {
    const a = await academy();
    const email = `minor-${randomUUID().slice(0, 8)}@example.com`;
    const created = await a.asTeacher("POST", "/students", {
      name: "Young Student",
      email,
      password: "StudentPass1",
      isMinor: true,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ guardianConsent: "required" });
    const userId = (created.body as { userId: string }).userId;
    expect((await systemPrisma.user.findUniqueOrThrow({ where: { id: userId } })).isMinor).toBe(true);

    const patch = (cookie: string) =>
      http.send("admin.localhost", "PATCH", `/api/admin/users/${userId}`, { isMinor: false }, { cookie });
    expect((await patch(a.teacher.cookie)).status).toBe(403);

    const home = await fx.tenant();
    const admin = await fx.staffLogin(home, "teacher", { superAdmin: true });
    adminIds.push(admin.user.id);
    const ok = await patch(admin.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ isMinor: false, status: "active" });
    const audit = await systemPrisma.auditLog.findFirstOrThrow({
      where: { action: "user.minor_flag_change", targetId: userId },
    });
    expect(audit.meta).toMatchObject({ previous: true, isMinor: false });

    await systemPrisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  });
});
