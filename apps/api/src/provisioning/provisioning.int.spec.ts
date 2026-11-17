// 10R.4 (FR-E08, ADR-013, docs/06 §0): direct account creation by role, the existing-account
// rules (D3), the first-staff-role password change (T4) and tenant isolation.
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, ProvisioningReason } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("ProvisionPassword1!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
const adminIds: string[] = [];
const createdEmails: string[] = [];

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  const created = await systemPrisma.user.findMany({
    where: { email: { in: createdEmails } },
    select: { id: true },
  });
  // Super admin audit rows carry no tenant (test cleanup only).
  await systemPrisma.auditLog.deleteMany({ where: { actorUserId: { in: adminIds } } });
  await fx.cleanup();
  await systemPrisma.user.deleteMany({ where: { id: { in: created.map((u) => u.id) } } });
  await systemPrisma.$disconnect();
});

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;
const newEmail = () => {
  const e = `prov-${randomUUID().slice(0, 8)}@example.com`;
  createdEmails.push(e);
  return e;
};
const userByEmail = (email: string) =>
  systemPrisma.user.findUniqueOrThrow({
    where: { email },
    include: { accounts: true, memberships: true },
  });

async function academy() {
  const t = await fx.tenant();
  const send = (cookie: string, method: string, path: string, body?: unknown) =>
    http.send(`${t.slug}.localhost`, method, `/api${path}`, body, { cookie });
  return { t, send };
}

async function superAdmin() {
  const t = await fx.tenant();
  const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });
  adminIds.push(admin.user.id);
  return {
    ...admin,
    addMember: (tenantId: string, body: unknown) =>
      http.send("admin.localhost", "POST", `/api/admin/tenants/${tenantId}/members`, body, {
        cookie: admin.cookie,
      }),
  };
}

describe("POST /api/students (direct creation by teacher and assistant)", () => {
  it("creates an active, unverified student with enrollments; no password anywhere", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const course = await systemPrisma.course.create({ data: { tenantId: t.id, title: "Algebra" } });
    const email = newEmail();

    const res = await send(teacher.cookie, "POST", "/students", {
      name: "Omar Ali",
      email,
      password: "Student8",
      courseIds: [course.id],
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      role: "student",
      existingUserLinked: false,
      emailVerified: false,
      mustChangePassword: true,
    });
    expect((res.body as { enrollmentIds: string[] }).enrollmentIds).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("Student8");

    const user = await userByEmail(email);
    expect(user).toMatchObject({ status: "active", emailVerified: false, mustChangePassword: true });
    expect(user.accounts[0]!.password).not.toBe("Student8");
    const audit = await systemPrisma.auditLog.findFirstOrThrow({
      where: { action: "member.create", targetId: (res.body as { membershipId: string }).membershipId },
    });
    expect(audit.actorUserId).toBe(teacher.user.id);
    expect(JSON.stringify(audit)).not.toContain("Student8");
  });

  it("lets an assistant create a student, and staff turn off the first-login change", async () => {
    const { t, send } = await academy();
    const assistant = await fx.staffLogin(t, "assistant");
    const email = newEmail();
    const res = await send(assistant.cookie, "POST", "/students", {
      name: "Sara",
      email,
      password: "Student8",
      requirePasswordChange: false,
    });
    expect(res.status).toBe(201);
    expect((await userByEmail(email)).mustChangePassword).toBe(false);
  });

  it("answers 409 USE_INVITATION for an existing account and MEMBERSHIP_ALREADY_EXISTS for a member", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const other = await fx.tenant();
    const { user: elsewhere } = await fx.member(other.id, "student");
    const { user: here } = await fx.member(t.id, "student");

    const linked = await send(teacher.cookie, "POST", "/students", {
      name: "Xavier",
      email: elsewhere.email,
      password: "Student8",
    });
    expect(linked.status).toBe(409);
    expect(reasonOf(linked.body)).toBe(ProvisioningReason.USE_INVITATION);
    expect(await systemPrisma.membership.count({ where: { userId: elsewhere.id } })).toBe(1);

    const member = await send(teacher.cookie, "POST", "/students", {
      name: "Xavier",
      email: here.email,
      password: "Student8",
    });
    expect(member.status).toBe(409);
    expect(reasonOf(member.body)).toBe(ProvisioningReason.MEMBERSHIP_ALREADY_EXISTS);
  });

  it("refuses another tenant's course and leaves no account behind", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const other = await fx.tenant();
    const foreign = await systemPrisma.course.create({ data: { tenantId: other.id, title: "B" } });
    const email = newEmail();
    const res = await send(teacher.cookie, "POST", "/students", {
      name: "Yusuf",
      email,
      password: "Student8",
      courseIds: [foreign.id],
    });
    expect(res.status).toBe(404);
    expect(reasonOf(res.body)).toBe("COURSE_NOT_FOUND");
    expect(await systemPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("refuses students", async () => {
    const { t, send } = await academy();
    const { user } = await fx.member(t.id, "student");
    const login = await fx.studentLogin(t, user.email); // binds this browser as the device
    expect(login.status).toBe(200);
    const res = await send(login.cookies, "POST", "/students", {
      name: "Zaid",
      email: newEmail(),
      password: "Student8",
    });
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
  });
});

describe("POST /api/assistants (teacher, direct)", () => {
  it("creates an unverified assistant who must change a 12+ password; existing emails get 409", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const email = newEmail();

    const short = await send(teacher.cookie, "POST", "/assistants", {
      name: "Helper",
      email,
      temporaryPassword: "Elevenchar1",
    });
    expect(short.status).toBe(400);

    const ok = await send(teacher.cookie, "POST", "/assistants", {
      name: "Helper",
      email,
      temporaryPassword: "TwelveChars1",
    });
    expect(ok.status).toBe(201);
    expect(await userByEmail(email)).toMatchObject({ emailVerified: false, mustChangePassword: true });

    const other = await fx.tenant();
    const { user: existing } = await fx.member(other.id, "teacher");
    const linked = await send(teacher.cookie, "POST", "/assistants", {
      name: "Xavier",
      email: existing.email,
      temporaryPassword: "TwelveChars1",
    });
    expect(linked.status).toBe(409);
    expect(reasonOf(linked.body)).toBe(ProvisioningReason.USE_INVITATION);
  });

  it("refuses assistants", async () => {
    const { t, send } = await academy();
    const assistant = await fx.staffLogin(t, "assistant");
    const res = await send(assistant.cookie, "POST", "/assistants", {
      name: "Helper",
      email: newEmail(),
      temporaryPassword: "TwelveChars1",
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/tenants/:tenantId/members (super admin)", () => {
  it("creates a teacher directly with a forced password change", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    const email = newEmail();
    const res = await admin.addMember(t.id, {
      email,
      role: "teacher",
      name: "New Teacher",
      password: "TwelveChars1",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: "teacher", existingUserLinked: false, mustChangePassword: true });
  });

  it("links an existing account without touching its password, name or other memberships", async () => {
    const admin = await superAdmin();
    const home = await fx.tenant();
    const { user } = await fx.member(home.id, "student");
    const before = await userByEmail(user.email);
    const t = await fx.tenant();

    const res = await admin.addMember(t.id, { email: user.email, role: "assistant" });
    expect(res.status).toBe(201);
    // T4: first staff role → must choose a new password under the 12-character rule.
    expect(res.body).toMatchObject({ existingUserLinked: true, mustChangePassword: true });

    const after = await userByEmail(user.email);
    expect(after.name).toBe(before.name);
    expect(after.accounts[0]!.password).toBe(before.accounts[0]!.password);
    expect(after.isSuperAdmin).toBe(false);
    expect(after.memberships.map((m) => [m.tenantId, m.role]).sort()).toEqual(
      [
        [home.id, "student"],
        [t.id, "assistant"],
      ].sort(),
    );

    const again = await admin.addMember(t.id, { email: user.email, role: "student" });
    expect(again.status).toBe(409);
    expect(reasonOf(again.body)).toBe(ProvisioningReason.MEMBERSHIP_ALREADY_EXISTS);
  });

  it("does not force a change for someone who is already staff elsewhere", async () => {
    const admin = await superAdmin();
    const home = await fx.tenant();
    const { user } = await fx.member(home.id, "teacher");
    const t = await fx.tenant();
    const res = await admin.addMember(t.id, { email: user.email, role: "teacher" });
    expect(res.body).toMatchObject({ existingUserLinked: true, mustChangePassword: false });
  });

  it("answers 404 for an unknown tenant and 403 for a teacher", async () => {
    const admin = await superAdmin();
    const missing = await admin.addMember(randomUUID(), {
      email: newEmail(),
      role: "student",
      name: "Nobody",
      password: "Student8",
    });
    expect(missing.status).toBe(404);

    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");
    const res = await http.send(
      "admin.localhost",
      "POST",
      `/api/admin/tenants/${t.id}/members`,
      { email: newEmail(), role: "teacher", name: "Xavier", password: "TwelveChars1" },
      { cookie: teacher.cookie },
    );
    expect(res.status).toBe(403);
  });
});
