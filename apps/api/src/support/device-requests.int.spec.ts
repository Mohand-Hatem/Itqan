// Step 5.6: device-change request (FR-D03, docs/05-auth-devices.md §5).
import { DEVICE_COOKIE_NAME, auth, hashDeviceSecret } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, SupportRequestReason } from "@itqan/shared";
import type { APIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "DeviceRequestPassword123!";
const fx = studentFixtures(PASSWORD);
const { member } = fx;
const makeTenant = fx.tenant;
const makeUser = fx.user;
/** A device already bound to the account (another browser), so a new browser hits DEVICE_LIMIT. */
const plantDevice = fx.device;
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

let ipCounter = 0;
const freshIp = () => `203.0.113.${++ipCounter}`;

function ask(
  slug: string,
  body: Record<string, unknown>,
  opts: { cookie?: string; ip?: string } = {},
) {
  return http.send(`${slug}.localhost`, "POST", "/api/device-requests", body, {
    "x-forwarded-for": opts.ip ?? freshIp(),
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
  });
}

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const deviceCookieFrom = (setCookie: string[] | undefined) =>
  setCookie?.find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`));
const requestsOf = (membershipId: string) =>
  systemPrisma.supportRequest.findMany({ where: { membershipId } });

describe("POST /api/device-requests", () => {
  it("a blocked student gets a pending device bound to this browser and an open request", async () => {
    const tenant = await makeTenant();
    const { user, membership } = await member(tenant.id);
    await plantDevice(user.id);

    const res = await ask(tenant.slug, {
      email: user.email,
      password: PASSWORD,
      message: "New laptop",
    });
    expect(res.status).toBe(201);
    const body = res.body as { requestId: string; status: string };
    expect(body.status).toBe("open");

    const raw = deviceCookieFrom(res.setCookie)!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/SameSite=Lax/i);
    const value = decodeURIComponent(raw.split(";")[0]!.split("=")[1]!);
    const [deviceId, secret] = value.split(".") as [string, string];

    const pending = await systemPrisma.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(pending).toMatchObject({ userId: user.id, status: "pending" });
    expect(pending.secretHash).toBe(hashDeviceSecret(secret));

    const [request] = await requestsOf(membership.id);
    expect(request).toMatchObject({
      id: body.requestId,
      tenantId: tenant.id,
      type: "device_change",
      status: "open",
      message: "New laptop",
      pendingDeviceId: deviceId,
    });
  });

  it("asking again from the same browser returns the same request", async () => {
    const tenant = await makeTenant();
    const { user, membership } = await member(tenant.id);
    await plantDevice(user.id);
    const first = await ask(tenant.slug, { email: user.email, password: PASSWORD });
    const cookie = deviceCookieFrom(first.setCookie)!.split(";")[0]!;

    const again = await ask(tenant.slug, { email: user.email, password: PASSWORD }, { cookie });
    expect(again.status).toBe(201);
    expect((again.body as { requestId: string }).requestId).toBe(
      (first.body as { requestId: string }).requestId,
    );
    expect(await requestsOf(membership.id)).toHaveLength(1);
    expect(await systemPrisma.device.count({ where: { userId: user.id } })).toBe(2);
  });

  it("another browser while a request is open gets REQUEST_ALREADY_OPEN", async () => {
    const tenant = await makeTenant();
    const { user, membership } = await member(tenant.id);
    await plantDevice(user.id);
    await ask(tenant.slug, { email: user.email, password: PASSWORD });

    const res = await ask(tenant.slug, { email: user.email, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(reasonOf(res.body)).toBe(SupportRequestReason.REQUEST_ALREADY_OPEN);
    expect(await requestsOf(membership.id)).toHaveLength(1);
  });

  it("is refused when a login would not hit the device limit", async () => {
    const tenant = await makeTenant();
    const { user, membership } = await member(tenant.id);
    const free = await ask(tenant.slug, { email: user.email, password: PASSWORD });
    expect(free.status).toBe(409);
    expect(reasonOf(free.body)).toBe(SupportRequestReason.DEVICE_REQUEST_NOT_NEEDED);

    const { cookie } = await plantDevice(user.id);
    const registered = await ask(
      tenant.slug,
      { email: user.email, password: PASSWORD },
      { cookie },
    );
    expect(reasonOf(registered.body)).toBe(SupportRequestReason.DEVICE_REQUEST_NOT_NEEDED);
    expect(await requestsOf(membership.id)).toHaveLength(0);
  });

  it("wrong password is 401 and writes nothing", async () => {
    const tenant = await makeTenant();
    const { user, membership } = await member(tenant.id);
    await plantDevice(user.id);
    const res = await ask(tenant.slug, { email: user.email, password: "WrongPassword999!" });
    expect(res.status).toBe(401);
    expect(res.setCookie).toBeUndefined();
    expect(await requestsOf(membership.id)).toHaveLength(0);
    expect(await systemPrisma.device.count({ where: { userId: user.id } })).toBe(1);
  });

  it("returns the same access reasons as login", async () => {
    const tenant = await makeTenant();
    const suspended = await member(tenant.id, "student", { suspended: true });
    const noMember = await makeUser();
    const teacher = await member(tenant.id, "teacher");
    const paused = await makeTenant(["student"]);
    const pausedStudent = await member(paused.id);

    const reason = async (slug: string, email: string) =>
      reasonOf((await ask(slug, { email, password: PASSWORD })).body);
    expect(await reason(tenant.slug, suspended.user.email)).toBe(AccessReasonCode.USER_SUSPENDED);
    expect(await reason(tenant.slug, noMember.email)).toBe(AccessReasonCode.NO_ACCESS);
    expect(await reason(tenant.slug, teacher.user.email)).toBe(AccessReasonCode.USE_STAFF_SIGN_IN);
    expect(await reason(paused.slug, pausedStudent.user.email)).toBe(
      AccessReasonCode.TENANT_PAUSED,
    );
  });

  it("rejects a malformed body with 400", async () => {
    const tenant = await makeTenant();
    expect((await ask(tenant.slug, { email: "not-an-email", password: PASSWORD })).status).toBe(
      400,
    );
  });

  it("the pending device cannot be used to sign in", async () => {
    const tenant = await makeTenant();
    const { user } = await member(tenant.id);
    await plantDevice(user.id);
    const res = await ask(tenant.slug, { email: user.email, password: PASSWORD });
    const cookie = deviceCookieFrom(res.setCookie)!.split(";")[0]!;

    const err = await auth.api
      .signInStudent({
        body: { email: user.email, password: PASSWORD },
        headers: new Headers({ host: `${tenant.slug}.localhost`, cookie }),
      })
      .then(
        () => null,
        (e: APIError) => e,
      );
    expect((err?.body as { code?: string })?.code).toBe(AccessReasonCode.DEVICE_LIMIT);
    expect(await systemPrisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("allows 3 requests per hour per email, from any IP", async () => {
    const tenant = await makeTenant();
    const { user } = await member(tenant.id);
    const body = { email: user.email, password: "WrongPassword999!" };
    for (let i = 0; i < 3; i++) expect((await ask(tenant.slug, body)).status).toBe(401);
    expect((await ask(tenant.slug, body)).status).toBe(429);
  });
});

describe("POST /api/device-requests: tenant isolation", () => {
  it("a member of tenant A cannot ask on tenant B's host", async () => {
    const [a, b] = [await makeTenant(), await makeTenant()];
    const { user, membership } = await member(a.id);
    await plantDevice(user.id);
    const res = await ask(b.slug, { email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.NO_ACCESS);
    expect(await requestsOf(membership.id)).toHaveLength(0);
  });

  it("the request belongs to the host's tenant, whatever the body says", async () => {
    const [a, b] = [await makeTenant(), await makeTenant()];
    const { user, membership } = await member(a.id);
    await plantDevice(user.id);
    const res = await ask(a.slug, { email: user.email, password: PASSWORD, tenantId: b.id });
    expect(res.status).toBe(201);
    const [request] = await requestsOf(membership.id);
    expect(request?.tenantId).toBe(a.id);
  });
});
