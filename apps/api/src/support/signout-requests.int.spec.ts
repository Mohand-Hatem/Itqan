// Step 5.7: sign-out-other-device request (FR-D05, docs/05-auth-devices.md §6).
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, SupportRequestReason } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "SignOutRequestPassword123!";
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

let ipCounter = 0;
const freshIp = () => `198.18.0.${++ipCounter}`;

function ask(slug: string, body: Record<string, unknown>, opts: { cookie?: string } = {}) {
  return http.send(`${slug}.localhost`, "POST", "/api/signout-requests", body, {
    "x-forwarded-for": freshIp(),
    ...(opts.cookie ? { cookie: opts.cookie } : {}),
  });
}

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const requestsOf = (membershipId: string) =>
  systemPrisma.supportRequest.findMany({ where: { membershipId } });

/**
 * A student signed in on a lost phone (device + open session) who now tries from a laptop.
 * With `ownDevice`, the laptop already has its own registered device (max_devices 2).
 */
async function blockedStudent(opts: { ownDevice?: boolean; maxDevices?: number } = {}) {
  const tenant = await fx.tenant();
  const { user, membership } = await fx.member(tenant.id, "student", {
    maxDevices: opts.maxDevices ?? 2,
  });
  const phone = await fx.device(user.id);
  await fx.session(user.id, phone.device.id, tenant.id);
  const laptop = opts.ownDevice ? await fx.device(user.id) : null;
  return { tenant, user, membership, laptopCookie: laptop?.cookie };
}

describe("POST /api/signout-requests", () => {
  it("a student blocked by a session on another device gets an open request", async () => {
    const s = await blockedStudent({ ownDevice: true });
    const res = await ask(
      s.tenant.slug,
      { email: s.user.email, password: PASSWORD, message: "Lost my phone" },
      { cookie: s.laptopCookie },
    );
    expect(res.status).toBe(201);
    const body = res.body as { requestId: string; status: string };
    expect(body.status).toBe("open");

    const [request] = await requestsOf(s.membership.id);
    expect(request).toMatchObject({
      id: body.requestId,
      tenantId: s.tenant.id,
      type: "sign_out_other",
      status: "open",
      message: "Lost my phone",
      pendingDeviceId: null,
    });
    // Takes nothing for this browser: no cookie, no new device, the other session untouched.
    expect(res.setCookie).toBeUndefined();
    expect(await systemPrisma.device.count({ where: { userId: s.user.id } })).toBe(2);
    expect(await systemPrisma.session.count({ where: { userId: s.user.id } })).toBe(1);
  });

  it("works from a browser with no device yet when the student is under the limit", async () => {
    const s = await blockedStudent();
    expect((await ask(s.tenant.slug, { email: s.user.email, password: PASSWORD })).status).toBe(
      201,
    );
  });

  it("asking again returns the same open request", async () => {
    const s = await blockedStudent();
    const first = await ask(s.tenant.slug, { email: s.user.email, password: PASSWORD });
    const again = await ask(s.tenant.slug, { email: s.user.email, password: PASSWORD });
    expect(again.status).toBe(201);
    expect((again.body as { requestId: string }).requestId).toBe(
      (first.body as { requestId: string }).requestId,
    );
    expect(await requestsOf(s.membership.id)).toHaveLength(1);
  });

  it("the other device's session counts on any tenant", async () => {
    const s = await blockedStudent();
    const other = await fx.tenant();
    await systemPrisma.session.updateMany({
      where: { userId: s.user.id },
      data: { tenantId: other.id },
    });
    expect((await ask(s.tenant.slug, { email: s.user.email, password: PASSWORD })).status).toBe(
      201,
    );
  });

  it("is refused when no other device has an open session", async () => {
    const tenant = await fx.tenant();
    const { user, membership } = await fx.member(tenant.id, "student", { maxDevices: 2 });
    const none = await ask(tenant.slug, { email: user.email, password: PASSWORD });
    expect(none.status).toBe(409);
    expect(reasonOf(none.body)).toBe(SupportRequestReason.SIGN_OUT_REQUEST_NOT_NEEDED);

    const phone = await fx.device(user.id);
    await fx.session(user.id, phone.device.id, tenant.id, -1000); // expired
    const expired = await ask(tenant.slug, { email: user.email, password: PASSWORD });
    expect(reasonOf(expired.body)).toBe(SupportRequestReason.SIGN_OUT_REQUEST_NOT_NEEDED);

    // The only open session is on this browser's own device.
    await systemPrisma.session.deleteMany({ where: { userId: user.id } });
    await fx.session(user.id, phone.device.id, tenant.id);
    const own = await ask(
      tenant.slug,
      { email: user.email, password: PASSWORD },
      { cookie: phone.cookie },
    );
    expect(reasonOf(own.body)).toBe(SupportRequestReason.SIGN_OUT_REQUEST_NOT_NEEDED);
    expect(await requestsOf(membership.id)).toHaveLength(0);
  });

  it("at the device limit with no device here, sends the student to the device change", async () => {
    const s = await blockedStudent({ maxDevices: 1 });
    const res = await ask(s.tenant.slug, { email: s.user.email, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.DEVICE_LIMIT);
    expect(await requestsOf(s.membership.id)).toHaveLength(0);
  });

  it("wrong password is 401 and writes nothing", async () => {
    const s = await blockedStudent();
    const res = await ask(s.tenant.slug, { email: s.user.email, password: "WrongPassword999!" });
    expect(res.status).toBe(401);
    expect(await requestsOf(s.membership.id)).toHaveLength(0);
  });

  it("returns the same access reasons as login", async () => {
    const tenant = await fx.tenant();
    const suspended = await fx.member(tenant.id, "student", { suspended: true });
    const teacher = await fx.member(tenant.id, "teacher");
    const noMember = await fx.user();
    const reason = async (email: string) =>
      reasonOf((await ask(tenant.slug, { email, password: PASSWORD })).body);
    expect(await reason(suspended.user.email)).toBe(AccessReasonCode.USER_SUSPENDED);
    expect(await reason(teacher.user.email)).toBe(AccessReasonCode.USE_STAFF_SIGN_IN);
    expect(await reason(noMember.email)).toBe(AccessReasonCode.NO_ACCESS);
  });

  it("allows 3 requests per hour per email, from any IP", async () => {
    const s = await blockedStudent();
    const body = { email: s.user.email, password: "WrongPassword999!" };
    for (let i = 0; i < 3; i++) expect((await ask(s.tenant.slug, body)).status).toBe(401);
    expect((await ask(s.tenant.slug, body)).status).toBe(429);
  });
});

describe("POST /api/signout-requests: tenant isolation", () => {
  it("a member of tenant A cannot ask on tenant B's host", async () => {
    const s = await blockedStudent();
    const b = await fx.tenant();
    const res = await ask(b.slug, { email: s.user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.NO_ACCESS);
    expect(await requestsOf(s.membership.id)).toHaveLength(0);
  });

  it("the request belongs to the host's tenant, whatever the body says", async () => {
    const s = await blockedStudent();
    const b = await fx.tenant();
    const res = await ask(s.tenant.slug, {
      email: s.user.email,
      password: PASSWORD,
      tenantId: b.id,
    });
    expect(res.status).toBe(201);
    const [request] = await requestsOf(s.membership.id);
    expect(request?.tenantId).toBe(s.tenant.id);
  });
});
