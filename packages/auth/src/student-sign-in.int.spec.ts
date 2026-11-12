// Step 5.3: student login (docs/05-auth-devices.md §3, ADR-011; FR-D01–D04, D07, D08).
import { randomUUID } from "node:crypto";
import { type Role, systemPrisma } from "@itqan/database";
import type { APIError } from "better-auth/api";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "./auth.js";
import {
  DEVICE_COOKIE_NAME,
  createDeviceSecret,
  formatDeviceCookie,
  hashDeviceSecret,
} from "./device-cookie.js";

const PASSWORD = "StudentPassword123!";
const userIds: string[] = [];
const tenantIds: string[] = [];

afterAll(async () => {
  await systemPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await systemPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await systemPrisma.$disconnect();
});

async function makeTenant(pausedRoles: Role[] = []) {
  const tenant = await systemPrisma.tenant.create({
    data: { slug: `t-${randomUUID().slice(0, 8)}`, name: "Login Test", pausedRoles },
  });
  tenantIds.push(tenant.id);
  return tenant;
}

async function makeUser(
  opts: { maxDevices?: number; suspended?: boolean; verified?: boolean; superAdmin?: boolean } = {},
) {
  const ctx = await auth.$context;
  const user = await systemPrisma.user.create({
    data: {
      email: `s-${randomUUID().slice(0, 8)}@example.com`,
      name: "Student",
      emailVerified: opts.verified ?? true,
      maxDevices: opts.maxDevices ?? 1,
      status: opts.suspended ? "suspended" : "active",
      isSuperAdmin: opts.superAdmin ?? false,
    },
  });
  await systemPrisma.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await ctx.password.hash(PASSWORD),
    },
  });
  userIds.push(user.id);
  return user;
}

async function student(tenantId: string, opts: Parameters<typeof makeUser>[0] = {}) {
  const user = await makeUser(opts);
  await systemPrisma.membership.create({ data: { userId: user.id, tenantId, role: "student" } });
  return user;
}

type Result = { status: number; code?: string; deviceCookie?: string; setCookies: string[] };

async function signIn(
  email: string,
  slug: string,
  opts: { cookie?: string; password?: string } = {},
): Promise<Result> {
  const headers = new Headers({ host: `${slug}.localhost` });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  try {
    const res = await auth.api.signInStudent({
      body: { email, password: opts.password ?? PASSWORD },
      headers,
      returnHeaders: true,
    });
    const setCookies = res.headers.getSetCookie();
    const device = setCookies.find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`));
    return { status: 200, setCookies, deviceCookie: device?.split(";")[0] };
  } catch (e) {
    const err = e as APIError;
    return { status: err.statusCode, code: (err.body as { code?: string })?.code, setCookies: [] };
  }
}

const sessions = (userId: string) => systemPrisma.session.findMany({ where: { userId } });
const devices = (userId: string) => systemPrisma.device.findMany({ where: { userId } });
const signOutEverywhere = (userId: string) =>
  systemPrisma.session.deleteMany({ where: { userId } });

describe("student sign-in: device binding", () => {
  it("first login binds a device, sets a secure cookie and a session carrying device and tenant", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);

    const res = await signIn(user.email, tenant.slug);
    expect(res.status).toBe(200);

    const [device] = await devices(user.id);
    expect(device).toMatchObject({ status: "active" });
    const [session] = await sessions(user.id);
    expect(session).toMatchObject({ deviceId: device!.id, tenantId: tenant.id });

    const raw = res.setCookies.find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    expect(raw).toMatch(/Domain=\.localhost/i);
    expect(raw).toMatch(/Max-Age=34560000/i);
    const secret = res.deviceCookie!.split(".").pop()!;
    expect(device!.secretHash).toBe(hashDeviceSecret(secret)); // only the hash is stored
    expect(res.setCookies.some((c) => c.includes("session_token="))).toBe(true);
  });

  it("a returning device signs in again without a new device", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);
    const first = await signIn(user.email, tenant.slug);
    await signOutEverywhere(user.id);

    const again = await signIn(user.email, tenant.slug, { cookie: first.deviceCookie });
    expect(again.status).toBe(200);
    expect(await devices(user.id)).toHaveLength(1);
    expect((await devices(user.id))[0]!.lastSeenAt).not.toBeNull();
  });

  it("blocks a new browser at the device limit with DEVICE_LIMIT and writes nothing", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);
    await signIn(user.email, tenant.slug);
    await signOutEverywhere(user.id);

    const res = await signIn(user.email, tenant.slug);
    expect(res).toMatchObject({ status: 403, code: "DEVICE_LIMIT" });
    expect(res.deviceCookie).toBeUndefined();
    expect(await devices(user.id)).toHaveLength(1);
    expect(await sessions(user.id)).toHaveLength(0);
  });

  it("allows a second device when max_devices is 2, then blocks the third", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id, { maxDevices: 2 });
    expect((await signIn(user.email, tenant.slug)).status).toBe(200);
    await signOutEverywhere(user.id);
    expect((await signIn(user.email, tenant.slug)).status).toBe(200);
    await signOutEverywhere(user.id);
    expect(await signIn(user.email, tenant.slug)).toMatchObject({ code: "DEVICE_LIMIT" });
    expect(await devices(user.id)).toHaveLength(2);
  });

  it("blocks while a session is open on another device, and rolls back the new device", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id, { maxDevices: 2 });
    await signIn(user.email, tenant.slug);

    const res = await signIn(user.email, tenant.slug);
    expect(res).toMatchObject({ status: 403, code: "SESSION_ON_OTHER_DEVICE" });
    expect(await devices(user.id)).toHaveLength(1);
    expect(await sessions(user.id)).toHaveLength(1);
  });

  it("an expired session on the other device does not block", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id, { maxDevices: 2 });
    await signIn(user.email, tenant.slug);
    await systemPrisma.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await signIn(user.email, tenant.slug)).status).toBe(200);
  });

  it("lets exactly one of two parallel logins from different browsers through", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id, { maxDevices: 2 });
    const results = await Promise.all([
      signIn(user.email, tenant.slug),
      signIn(user.email, tenant.slug),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(results.find((r) => r.status === 403)?.code).toBe("SESSION_ON_OTHER_DEVICE");
    expect(await sessions(user.id)).toHaveLength(1);
    expect(await devices(user.id)).toHaveLength(1);
  });

  it("the same device may open a session on another tenant", async () => {
    const [a, b] = [await makeTenant(), await makeTenant()];
    const user = await student(a.id);
    await systemPrisma.membership.create({
      data: { userId: user.id, tenantId: b.id, role: "student" },
    });

    const first = await signIn(user.email, a.slug);
    const second = await signIn(user.email, b.slug, { cookie: first.deviceCookie });
    expect(second.status).toBe(200);
    const rows = await sessions(user.id);
    expect(rows.map((s) => s.tenantId).sort()).toEqual([a.id, b.id].sort());
    expect(new Set(rows.map((s) => s.deviceId)).size).toBe(1);
  });
});

describe("student sign-in: device cookies that do not count", () => {
  async function plantDevice(userId: string, status: "active" | "pending" | "revoked") {
    const secret = createDeviceSecret();
    const device = await systemPrisma.device.create({
      data: { userId, status, secretHash: hashDeviceSecret(secret) },
    });
    return { device, cookie: `${DEVICE_COOKIE_NAME}=${formatDeviceCookie(device.id, secret)}` };
  }

  it("a revoked device cookie counts as no device", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);
    const { device, cookie } = await plantDevice(user.id, "revoked");
    expect((await signIn(user.email, tenant.slug, { cookie })).status).toBe(200);
    const [session] = await sessions(user.id);
    expect(session!.deviceId).not.toBe(device.id);
  });

  it("a pending device cookie counts as no device", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);
    await plantDevice(user.id, "active");
    const { cookie } = await plantDevice(user.id, "pending");
    expect(await signIn(user.email, tenant.slug, { cookie })).toMatchObject({
      code: "DEVICE_LIMIT",
    });
  });

  it("another user's device or a wrong secret counts as no device", async () => {
    const tenant = await makeTenant();
    const owner = await student(tenant.id);
    const { device, cookie } = await plantDevice(owner.id, "active");
    const user = await student(tenant.id);
    await plantDevice(user.id, "active");

    expect(await signIn(user.email, tenant.slug, { cookie })).toMatchObject({
      code: "DEVICE_LIMIT",
    });
    const forged = `${DEVICE_COOKIE_NAME}=${formatDeviceCookie(device.id, createDeviceSecret())}`;
    expect(await signIn(owner.email, tenant.slug, { cookie: forged })).toMatchObject({
      code: "DEVICE_LIMIT",
    });
  });
});

describe("student sign-in: access checks", () => {
  it("wrong password is 401 and writes nothing", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);
    const res = await signIn(user.email, tenant.slug, { password: "WrongPassword999!" });
    expect(res.status).toBe(401);
    expect(await devices(user.id)).toHaveLength(0);
    expect(await sessions(user.id)).toHaveLength(0);
  });

  it("unverified email is refused", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id, { verified: false });
    expect(await signIn(user.email, tenant.slug)).toMatchObject({
      status: 403,
      code: "EMAIL_NOT_VERIFIED",
    });
  });

  it("USER_SUSPENDED, NO_ACCESS and TENANT_PAUSED", async () => {
    const tenant = await makeTenant();
    const suspended = await student(tenant.id, { suspended: true });
    expect(await signIn(suspended.email, tenant.slug)).toMatchObject({ code: "USER_SUSPENDED" });

    const noMembership = await makeUser();
    expect(await signIn(noMembership.email, tenant.slug)).toMatchObject({ code: "NO_ACCESS" });

    const suspendedMember = await student(tenant.id);
    await systemPrisma.membership.updateMany({
      where: { userId: suspendedMember.id },
      data: { status: "suspended" },
    });
    expect(await signIn(suspendedMember.email, tenant.slug)).toMatchObject({ code: "NO_ACCESS" });

    const paused = await makeTenant(["student"]);
    const pausedStudent = await student(paused.id);
    expect(await signIn(pausedStudent.email, paused.slug)).toMatchObject({ code: "TENANT_PAUSED" });
    expect(await devices(pausedStudent.id)).toHaveLength(0);
  });

  it("tenant isolation: a member of tenant A cannot sign in on tenant B's host", async () => {
    const [a, b] = [await makeTenant(), await makeTenant()];
    const user = await student(a.id);
    expect(await signIn(user.email, b.slug)).toMatchObject({ status: 403, code: "NO_ACCESS" });
    expect(await sessions(user.id)).toHaveLength(0);
  });

  it("an unknown or admin host is 404", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);
    expect(await signIn(user.email, "no-such-tenant")).toMatchObject({
      status: 404,
      code: "TENANT_NOT_FOUND",
    });
    expect(await signIn(user.email, "admin")).toMatchObject({
      status: 404,
      code: "TENANT_NOT_FOUND",
    });
  });

  it("staff and super admins are sent to the staff sign-in", async () => {
    const tenant = await makeTenant();
    const teacher = await makeUser();
    await systemPrisma.membership.create({
      data: { userId: teacher.id, tenantId: tenant.id, role: "teacher" },
    });
    expect(await signIn(teacher.email, tenant.slug)).toMatchObject({
      status: 403,
      code: "USE_STAFF_SIGN_IN",
    });

    const admin = await makeUser({ superAdmin: true });
    expect(await signIn(admin.email, tenant.slug)).toMatchObject({ code: "USE_STAFF_SIGN_IN" });
    expect(await sessions(teacher.id)).toHaveLength(0);
  });
});

describe("stock /sign-in/email after ADR-011", () => {
  it("refuses a student-only user with USE_STUDENT_SIGN_IN and creates no session", async () => {
    const tenant = await makeTenant();
    const user = await student(tenant.id);
    const err = await auth.api
      .signInEmail({ body: { email: user.email, password: PASSWORD } })
      .then(
        () => null,
        (e: APIError) => e,
      );
    expect(err?.statusCode).toBe(403);
    expect((err?.body as { code?: string })?.code).toBe("USE_STUDENT_SIGN_IN");
    expect(await sessions(user.id)).toHaveLength(0);
  });

  it("still signs in staff", async () => {
    const tenant = await makeTenant();
    const teacher = await makeUser();
    await systemPrisma.membership.create({
      data: { userId: teacher.id, tenantId: tenant.id, role: "teacher" },
    });
    const res = await auth.api.signInEmail({ body: { email: teacher.email, password: PASSWORD } });
    expect(res.token).toBeTruthy();
  });
});

describe("student sign-in rate limit", () => {
  it("allows 5 attempts per minute per IP, then 429", async () => {
    const ip = "198.51.100.77";
    const attempt = () =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-in/student", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ email: "nobody@example.com", password: "WrongPassword123!" }),
        }),
      );
    for (let i = 0; i < 5; i++) expect((await attempt()).status).not.toBe(429);
    expect((await attempt()).status).toBe(429);
  });
});
