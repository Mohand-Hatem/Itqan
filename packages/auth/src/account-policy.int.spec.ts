// 10R.3: account states, verified-only emails, password lengths, the first-login password change
// and the staff sign-in audit (docs/05 §1a, §1b, §8; ADR-012, ADR-013).
import { randomUUID } from "node:crypto";
import { type Role, systemPrisma } from "@itqan/database";
import type { APIError } from "better-auth/api";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, clearTestMailbox, getLastSentEmail } from "./index.js";

const PASSWORD = "StartPassword123!";
const userIds: string[] = [];
let tenantId: string;

const cookiesOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .join("; ");

beforeAll(async () => {
  const tenant = await systemPrisma.tenant.create({
    data: { slug: `pol-${randomUUID().slice(0, 8)}`, name: "Policy Test Tenant" },
  });
  tenantId = tenant.id;
});

beforeEach(() => clearTestMailbox());

afterAll(async () => {
  // Sign-in audit rows name the account as target only (no foreign key), so users can go.
  await systemPrisma.auditLog.deleteMany({ where: { targetId: { in: userIds } } });
  await systemPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await systemPrisma.tenant.delete({ where: { id: tenantId } });
  await systemPrisma.$disconnect();
});

/** An account as staff create it directly: a password, any status, maybe unverified. */
async function account(
  opts: {
    role?: Role | null;
    emailVerified?: boolean;
    status?: "active" | "pending" | "suspended";
    mustChangePassword?: boolean;
  } = {},
) {
  const ctx = await auth.$context;
  const user = await systemPrisma.user.create({
    data: {
      email: `pol-${randomUUID().slice(0, 8)}@example.com`,
      name: "Policy Test",
      emailVerified: opts.emailVerified ?? true,
      status: opts.status ?? "active",
      mustChangePassword: opts.mustChangePassword ?? false,
    },
  });
  userIds.push(user.id);
  await systemPrisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await ctx.password.hash(PASSWORD),
    },
  });
  const role = opts.role === undefined ? "teacher" : opts.role;
  if (role) await systemPrisma.membership.create({ data: { userId: user.id, tenantId, role } });
  return user;
}

const signIn = async (email: string, password = PASSWORD) => {
  const res = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  return new Headers({ cookie: cookiesOf(res.headers) });
};

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "OK";
  } catch (e) {
    return String(((e as APIError).body as { code?: string })?.code);
  }
};

async function resetToken(email: string) {
  await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
  return getLastSentEmail(email)?.token;
}

describe("account states (FR-A01)", () => {
  it("keeps a self-registered account pending, without a session, until its email is verified", async () => {
    const email = `pol-${randomUUID().slice(0, 8)}@example.com`;
    const signUp = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "New" } });
    userIds.push(signUp.user.id);
    expect(signUp.token).toBeNull();
    expect((await systemPrisma.user.findUniqueOrThrow({ where: { email } })).status).toBe("pending");

    expect(await codeOf(signIn(email))).toBe("EMAIL_NOT_VERIFIED");

    await auth.api.verifyEmail({ query: { token: getLastSentEmail(email)!.token! } });
    expect((await systemPrisma.user.findUniqueOrThrow({ where: { email } })).status).toBe("active");
    expect(await codeOf(signIn(email))).toBe("OK");
  });

  it("lets an account created directly by staff sign in while its email is unverified", async () => {
    const user = await account({ emailVerified: false });
    expect(await codeOf(signIn(user.email))).toBe("OK");
  });

  it("gives a suspended account no session", async () => {
    const user = await account({ status: "suspended" });
    expect(await codeOf(signIn(user.email))).toBe("USER_SUSPENDED");
    expect(await systemPrisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("emails to unverified addresses (FR-A02, docs/05 §1a)", () => {
  it("sends no reset link to an unverified address and answers exactly as for a verified one", async () => {
    const unverified = await account({ emailVerified: false });
    const verified = await account();
    const body = (email: string) => ({ email, redirectTo: "/reset-password" });

    const quiet = await auth.api.requestPasswordReset({ body: body(unverified.email) });
    const sent = await auth.api.requestPasswordReset({ body: body(verified.email) });

    expect(quiet).toEqual(sent);
    expect(getLastSentEmail(unverified.email)).toBeUndefined();
    expect(getLastSentEmail(verified.email)?.type).toBe("reset");
  });

  it("sends an active unverified account a verification link only when it asks while signed in", async () => {
    const user = await account({ emailVerified: false });

    const anonymous = await auth.api.sendVerificationEmail({ body: { email: user.email } });
    expect(anonymous).toEqual({ status: true });
    expect(getLastSentEmail(user.email)).toBeUndefined();

    await auth.api.sendVerificationEmail({
      body: { email: user.email },
      headers: await signIn(user.email),
    });
    expect(getLastSentEmail(user.email)?.type).toBe("verification");
  });

  it("still sends a pending account its verification link without a session", async () => {
    const user = await account({ emailVerified: false, status: "pending", role: "student" });
    await auth.api.sendVerificationEmail({ body: { email: user.email } });
    expect(getLastSentEmail(user.email)?.type).toBe("verification");
  });
});

describe("password lengths (FR-A09)", () => {
  it("refuses a staff password under 12 characters at change and reset, and accepts 12", async () => {
    const teacher = await account();
    const headers = await signIn(teacher.email);
    const change = (newPassword: string, currentPassword = PASSWORD) =>
      codeOf(auth.api.changePassword({ body: { currentPassword, newPassword }, headers }));

    expect(await change("Elevenchar1")).toBe("PASSWORD_TOO_SHORT");
    expect(await change("Twelvechars1")).toBe("OK");

    const token = await resetToken(teacher.email);
    const reset = (newPassword: string) =>
      codeOf(auth.api.resetPassword({ body: { token: token!, newPassword } }));
    expect(await reset("Elevenchar1")).toBe("PASSWORD_TOO_SHORT");
    expect(await reset("Twelvechar22")).toBe("OK");
  });

  it("accepts an 8-character student password at reset", async () => {
    const student = await account({ role: "student" });
    const token = await resetToken(student.email);
    expect(await codeOf(auth.api.resetPassword({ body: { token: token!, newPassword: "Eight888" } }))).toBe("OK");
  });
});

describe("first-login password change (FR-A08)", () => {
  it("clears the flag and ends the other sessions after a change, keeping the current one", async () => {
    const teacher = await account({ mustChangePassword: true });
    const current = await signIn(teacher.email);
    await signIn(teacher.email); // another browser, opened with the password someone else knew
    expect(await systemPrisma.session.count({ where: { userId: teacher.id } })).toBe(2);

    await auth.api.changePassword({
      body: { currentPassword: PASSWORD, newPassword: "MyOwnPassword12" },
      headers: current,
    });

    const row = await systemPrisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    expect(row.mustChangePassword).toBe(false);
    expect(await systemPrisma.session.count({ where: { userId: teacher.id } })).toBe(1);
    expect(await auth.api.getSession({ headers: current })).not.toBeNull();
  });

  it("clears the flag after a self-service reset", async () => {
    const teacher = await account({ mustChangePassword: true });
    const token = await resetToken(teacher.email);
    await auth.api.resetPassword({ body: { token: token!, newPassword: "MyOwnPassword12" } });
    const row = await systemPrisma.user.findUniqueOrThrow({ where: { id: teacher.id } });
    expect(row.mustChangePassword).toBe(false);
  });
});

describe("staff sign-in audit (FR-L01)", () => {
  const rowsFor = (targetId: string | null, action: string) =>
    systemPrisma.auditLog.findMany({ where: { targetId, action }, orderBy: { createdAt: "desc" } });

  it("writes one success row with the account as target and nothing secret", async () => {
    const teacher = await account();
    await signIn(teacher.email);
    const rows = await rowsFor(teacher.id, "auth.sign_in.success");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorUserId: null, targetType: "user", meta: {} });
    expect(JSON.stringify(rows[0])).not.toContain(PASSWORD);
  });

  it("writes failure rows with a category, and never stores an unknown email", async () => {
    const teacher = await account();
    expect(await codeOf(signIn(teacher.email, "WrongPassword123!"))).toBe("INVALID_EMAIL_OR_PASSWORD");
    const known = await rowsFor(teacher.id, "auth.sign_in.failure");
    expect(known).toHaveLength(1);
    expect(known[0]!.meta).toEqual({ reason: "invalid_credentials" });
    expect(JSON.stringify(known[0])).not.toContain("WrongPassword123!");

    const student = await account({ role: "student" });
    expect(await codeOf(signIn(student.email))).toBe("USE_STUDENT_SIGN_IN");
    expect((await rowsFor(student.id, "auth.sign_in.failure"))[0]!.meta).toEqual({
      reason: "use_student_sign_in",
    });

    const unknown = `nobody-${randomUUID().slice(0, 8)}@example.com`;
    const before = Date.now();
    expect(await codeOf(signIn(unknown))).toBe("INVALID_EMAIL_OR_PASSWORD");
    const anonymous = await systemPrisma.auditLog.findMany({
      where: { action: "auth.sign_in.failure", targetId: null, createdAt: { gte: new Date(before) } },
    });
    expect(anonymous.length).toBeGreaterThan(0);
    expect(JSON.stringify(anonymous)).not.toContain(unknown);
    // Test cleanup only: these rows reference no test user.
    await systemPrisma.auditLog.deleteMany({ where: { id: { in: anonymous.map((r) => r.id) } } });
  });
});
