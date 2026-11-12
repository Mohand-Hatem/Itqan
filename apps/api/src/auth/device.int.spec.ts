// Step 5.4: per-request device check (docs/03-system-design.md §3 step 4, docs/05 §8).
import { randomUUID } from "node:crypto";
import { Controller, Get, Module } from "@nestjs/common";
import {
  DEVICE_COOKIE_NAME,
  auth,
  createDeviceSecret,
  formatDeviceCookie,
  hashDeviceSecret,
} from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHttpTestApp } from "../testing/http.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AuthModule } from "./auth.module.js";
import { Public } from "./public.decorator.js";

class DeviceProbeController {
  protectedRoute() {
    return { ok: true };
  }
  publicRoute() {
    return { ok: true };
  }
}
const protDesc = Object.getOwnPropertyDescriptor(
  DeviceProbeController.prototype,
  "protectedRoute",
)!;
Get("protected")(DeviceProbeController.prototype, "protectedRoute", protDesc);
const pubDesc = Object.getOwnPropertyDescriptor(DeviceProbeController.prototype, "publicRoute")!;
Public()(DeviceProbeController.prototype, "publicRoute", pubDesc);
Get("public")(DeviceProbeController.prototype, "publicRoute", pubDesc);
Controller("device-probe")(DeviceProbeController);

class TestAppModule {}
Module({ imports: [TenancyModule, AuthModule], controllers: [DeviceProbeController] })(
  TestAppModule,
);

const PASSWORD = "DeviceGuardPassword123!";
const userIds: string[] = [];
const tenantIds: string[] = [];
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let tenantA: { id: string; slug: string };
let tenantB: { id: string; slug: string };

async function makeUser(opts: { superAdmin?: boolean } = {}) {
  const ctx = await auth.$context;
  const user = await systemPrisma.user.create({
    data: {
      email: `dg-${randomUUID().slice(0, 8)}@example.com`,
      name: "Device Guard",
      emailVerified: true,
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

const cookiesOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .filter(Boolean);

/** A real student signed in through /sign-in/student: { session, device } cookie pairs. */
async function signedInStudent() {
  const user = await makeUser();
  await systemPrisma.membership.create({
    data: { userId: user.id, tenantId: tenantA.id, role: "student" },
  });
  const res = await auth.api.signInStudent({
    body: { email: user.email, password: PASSWORD },
    headers: new Headers({ host: `${tenantA.slug}.localhost` }),
    returnHeaders: true,
  });
  const all = cookiesOf(res.headers);
  const session = all.find((c) => !c.startsWith(`${DEVICE_COOKIE_NAME}=`))!;
  const device = all.find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`))!;
  return { user, session, device, both: `${session}; ${device}` };
}

async function plantDevice(userId: string) {
  const secret = createDeviceSecret();
  const device = await systemPrisma.device.create({
    data: { userId, secretHash: hashDeviceSecret(secret) },
  });
  return `${DEVICE_COOKIE_NAME}=${formatDeviceCookie(device.id, secret)}`;
}

const get = (slug: string, path: string, cookie?: string) =>
  http.send(
    `${slug}.localhost`,
    "GET",
    `/api/device-probe/${path}`,
    undefined,
    cookie ? { cookie } : {},
  );

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;

beforeAll(async () => {
  http = await createHttpTestApp(TestAppModule);
  for (const label of ["a", "b"]) {
    const t = await systemPrisma.tenant.create({
      data: { slug: `dg-${label}-${randomUUID().slice(0, 8)}`, name: "Device Guard Tenant" },
    });
    tenantIds.push(t.id);
  }
  [tenantA, tenantB] = (await systemPrisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    orderBy: { slug: "asc" },
  })) as [typeof tenantA, typeof tenantB];
});

afterAll(async () => {
  await http?.close();
  await systemPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await systemPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await systemPrisma.$disconnect();
});

describe("DeviceGuard: students", () => {
  it("accepts the session together with its own device cookie", async () => {
    const s = await signedInStudent();
    expect((await get(tenantA.slug, "protected", s.both)).status).toBe(200);
  });

  it("rejects a copied session cookie without the device cookie", async () => {
    const s = await signedInStudent();
    const res = await get(tenantA.slug, "protected", s.session);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.DEVICE_NOT_REGISTERED);
  });

  it("rejects the student's own other device", async () => {
    const s = await signedInStudent();
    const other = await plantDevice(s.user.id);
    const res = await get(tenantA.slug, "protected", `${s.session}; ${other}`);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.DEVICE_NOT_REGISTERED);
  });

  it("rejects another user's device cookie and a forged secret", async () => {
    const s = await signedInStudent();
    const stranger = await makeUser();
    const theirs = await plantDevice(stranger.id);
    expect(reasonOf((await get(tenantA.slug, "protected", `${s.session}; ${theirs}`)).body)).toBe(
      AccessReasonCode.DEVICE_NOT_REGISTERED,
    );

    const deviceId = s.device.split("=")[1]!.split(".")[0]!;
    const forged = `${DEVICE_COOKIE_NAME}=${formatDeviceCookie(deviceId, createDeviceSecret())}`;
    expect(reasonOf((await get(tenantA.slug, "protected", `${s.session}; ${forged}`)).body)).toBe(
      AccessReasonCode.DEVICE_NOT_REGISTERED,
    );
  });

  it("rejects a revoked device at once", async () => {
    const s = await signedInStudent();
    await systemPrisma.device.updateMany({
      where: { userId: s.user.id },
      data: { status: "revoked", revokedAt: new Date() },
    });
    const res = await get(tenantA.slug, "protected", s.both);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.DEVICE_NOT_REGISTERED);
    // The session is left alone: a rejected request must not sign the student out.
    expect(await systemPrisma.session.count({ where: { userId: s.user.id } })).toBe(1);
  });

  it("does not touch public routes", async () => {
    const s = await signedInStudent();
    expect((await get(tenantA.slug, "public", s.session)).status).toBe(200);
  });

  it("tenant isolation: the student's cookies are refused on another tenant's host", async () => {
    const s = await signedInStudent();
    const res = await get(tenantB.slug, "protected", s.both);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.NO_ACCESS);
  });

  // Security audit, Phase 5: a password-only student session must not open staff routes
  // (which need TOTP) on another tenant where the same user is staff.
  it("a student session is refused on another tenant where the user is staff", async () => {
    const s = await signedInStudent();
    await systemPrisma.membership.create({
      data: { userId: s.user.id, tenantId: tenantB.id, role: "assistant" },
    });
    const res = await get(tenantB.slug, "protected", s.both);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.NO_ACCESS);
  });

  it("a student session works only on the tenant it was opened on", async () => {
    const s = await signedInStudent();
    await systemPrisma.membership.create({
      data: { userId: s.user.id, tenantId: tenantB.id, role: "student" },
    });
    const res = await get(tenantB.slug, "protected", s.both);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.NO_ACCESS);
    expect((await get(tenantA.slug, "protected", s.both)).status).toBe(200);
  });
});

describe("DeviceGuard: staff and super admins have no device rules", () => {
  it("lets a teacher in without a device cookie", async () => {
    const teacher = await makeUser();
    await systemPrisma.membership.create({
      data: { userId: teacher.id, tenantId: tenantA.id, role: "teacher" },
    });
    const res = await auth.api.signInEmail({
      body: { email: teacher.email, password: PASSWORD },
      returnHeaders: true,
    });
    expect((await get(tenantA.slug, "protected", cookiesOf(res.headers).join("; "))).status).toBe(
      200,
    );
  });

  it("lets a super admin in without a device cookie", async () => {
    const admin = await makeUser({ superAdmin: true });
    const res = await auth.api.signInEmail({
      body: { email: admin.email, password: PASSWORD },
      returnHeaders: true,
    });
    expect((await get(tenantA.slug, "protected", cookiesOf(res.headers).join("; "))).status).toBe(
      200,
    );
  });
});
