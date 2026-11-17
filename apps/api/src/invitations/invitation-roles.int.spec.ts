// 10R.6 (FR-E01, FR-A09, ADR-013): invitations for every role, who may invite whom, accepting
// proves the email (T2), accept with password for a pending account (C1), first staff role (T4),
// role-aware email and Resend idempotency keys.
import { randomUUID } from "node:crypto";
import { auth, clearTestMailbox, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, PASSWORD_TOO_SHORT, ProvisioningReason } from "@itqan/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "InvitePassword123!";
const fx = studentFixtures(PASSWORD);
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
const adminIds: string[] = [];
const createdEmails: string[] = [];

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});
beforeEach(() => clearTestMailbox());

afterAll(async () => {
  await http?.close();
  await systemPrisma.auditLog.deleteMany({ where: { actorUserId: { in: adminIds } } });
  await fx.cleanup();
  await systemPrisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  await systemPrisma.$disconnect();
});

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;
const newEmail = () => {
  const e = `inv-${randomUUID().slice(0, 8)}@example.com`;
  createdEmails.push(e);
  return e;
};
const cookiesOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .join("; ");

async function academy() {
  const t = await fx.tenant();
  const send = (method: string, path: string, body?: unknown, cookie?: string) =>
    http.send(`${t.slug}.localhost`, method, `/api${path}`, body, cookie ? { cookie } : {});
  return { t, send };
}

/** An account staff created directly: active, email not verified. */
async function directAccount(opts: { pending?: boolean } = {}) {
  const ctx = await auth.$context;
  const email = newEmail();
  const user = await systemPrisma.user.create({
    data: { email, name: "Existing Person", emailVerified: false, status: opts.pending ? "pending" : "active" },
  });
  await systemPrisma.account.create({
    data: { userId: user.id, accountId: user.id, providerId: "credential", password: await ctx.password.hash(PASSWORD) },
  });
  return user;
}

describe("who may invite whom (FR-E01)", () => {
  it("lets a teacher invite an assistant, who registers with a 12+ password and gets that role", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const email = newEmail();

    const created = await send("POST", "/invitations", { email, role: "assistant" }, teacher.cookie);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ role: "assistant", courseIds: [] });

    const sent = getLastSentEmail(email)!;
    expect(sent.text).toContain("مساعداً");
    expect(sent.idempotencyKey).toMatch(new RegExp(`^invitation:${(created.body as { id: string }).id}:`));

    const check = await send("GET", `/invitations/check?token=${sent.token}`);
    expect(check.body).toMatchObject({ role: "assistant", userExists: false });

    const short = await send("POST", "/register", { token: sent.token, name: "Helper", password: "Elevenchar1" });
    expect(short.status).toBe(400);
    expect(reasonOf(short.body)).toBe(PASSWORD_TOO_SHORT);

    // The failed attempt rolled back its claim: the same link still works.
    const ok = await send("POST", "/register", { token: sent.token, name: "Helper", password: "TwelveChars1" });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ role: "assistant" });
    const user = await systemPrisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: true } });
    expect(user).toMatchObject({ emailVerified: true, mustChangePassword: false, status: "active" });
    expect(user.memberships[0]).toMatchObject({ tenantId: t.id, role: "assistant" });
  });

  it("lets an assistant invite students only; nobody but the super admin invites teachers", async () => {
    const { t, send } = await academy();
    const assistant = await fx.staffLogin(t, "assistant");
    const teacher = await fx.staffLogin(t, "teacher");
    const course = await systemPrisma.course.create({ data: { tenantId: t.id, title: "Physics" } });

    const student = await send(
      "POST",
      "/invitations",
      { email: newEmail(), role: "student", courseIds: [course.id] },
      assistant.cookie,
    );
    expect(student.status).toBe(201);

    for (const [cookie, role] of [
      [assistant.cookie, "assistant"],
      [teacher.cookie, "teacher"],
    ] as const) {
      const res = await send("POST", "/invitations", { email: newEmail(), role }, cookie);
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    }
  });

  it("keeps courses for student invitations and refuses a staff invitation to a member", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const course = await systemPrisma.course.create({ data: { tenantId: t.id, title: "Chemistry" } });
    const withCourses = await send(
      "POST",
      "/invitations",
      { email: newEmail(), role: "assistant", courseIds: [course.id] },
      teacher.cookie,
    );
    expect(withCourses.status).toBe(400);
    const noCourses = await send("POST", "/invitations", { email: newEmail(), role: "student" }, teacher.cookie);
    expect(noCourses.status).toBe(400);

    const { user: member } = await fx.member(t.id, "student");
    const res = await send("POST", "/invitations", { email: member.email, role: "assistant" }, teacher.cookie);
    expect(res.status).toBe(409);
    expect(reasonOf(res.body)).toBe(ProvisioningReason.MEMBERSHIP_ALREADY_EXISTS);
  });

  it("lets the super admin invite a teacher with a link on the academy's own address", async () => {
    const home = await fx.tenant();
    const admin = await fx.staffLogin(home, "teacher", { superAdmin: true });
    adminIds.push(admin.user.id);
    const t = await fx.tenant();
    const email = newEmail();

    const res = await http.send(
      "admin.localhost",
      "POST",
      `/api/admin/tenants/${t.id}/invitations`,
      { email, role: "teacher" },
      { cookie: admin.cookie },
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ role: "teacher" });
    const sent = getLastSentEmail(email)!;
    expect(new URL(sent.url!).host).toBe(`${t.slug}.localhost`);
  });
});

describe("accepting proves the email (T2, C1, T4)", () => {
  it("marks a signed-in, unverified account verified when it accepts", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const course = await systemPrisma.course.create({ data: { tenantId: t.id, title: "Math" } });
    const user = await directAccount();
    await send("POST", "/invitations", { email: user.email, role: "student", courseIds: [course.id] }, teacher.cookie);
    const token = getLastSentEmail(user.email)!.token!;

    const signIn = await auth.api.signInEmail({ body: { email: user.email, password: PASSWORD }, returnHeaders: true });
    const res = await send("POST", "/invitations/accept", { token }, cookiesOf(signIn.headers));
    expect(res.status).toBe(200);
    expect((await systemPrisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(true);
  });

  it("lets a pending account accept with its own password; a wrong password changes nothing", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const user = await directAccount({ pending: true });
    await send("POST", "/invitations", { email: user.email, role: "assistant" }, teacher.cookie);
    const token = getLastSentEmail(user.email)!.token!;

    const wrong = await send("POST", "/invitations/accept-with-password", { token, password: "WrongPassword9!" });
    expect(wrong.status).toBe(401);
    expect(
      (await systemPrisma.invitation.findFirstOrThrow({ where: { email: user.email } })).redeemedAt,
    ).toBeNull();

    const ok = await send("POST", "/invitations/accept-with-password", { token, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ role: "assistant" });
    const after = await systemPrisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { memberships: true, accounts: true },
    });
    // Mailbox proven, account usable, first staff role → new password under the 12 rule.
    expect(after).toMatchObject({ status: "active", emailVerified: true, mustChangePassword: true });
    expect(after.memberships[0]).toMatchObject({ tenantId: t.id, role: "assistant" });
    await expect(
      auth.api.signInEmail({ body: { email: user.email, password: PASSWORD } }),
    ).resolves.toMatchObject({ user: { id: user.id } });
  });

  it("gives a resent invitation a new idempotency key (a new token is a new message)", async () => {
    const { t, send } = await academy();
    const teacher = await fx.staffLogin(t, "teacher");
    const email = newEmail();
    const created = await send("POST", "/invitations", { email, role: "assistant" }, teacher.cookie);
    const first = getLastSentEmail(email)!.idempotencyKey;
    await send("POST", `/invitations/${(created.body as { id: string }).id}/resend`, undefined, teacher.cookie);
    const second = getLastSentEmail(email)!.idempotencyKey;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});
