// Step 5.8a: staff list, approve and reject device and sign-out requests (FR-D06).
import { DEVICE_COOKIE_NAME, auth } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, SupportRequestReason } from "@itqan/shared";
import type { APIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "StaffDecisionPassword123!";
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

type Tenant = { id: string; slug: string };
const host = (t: Tenant) => `${t.slug}.localhost`;
const cookiesOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .join("; ");
const deviceCookieOf = (cookies: string) =>
  cookies.split("; ").find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`));
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;

/** A browser signing in as a student: { status, code, cookies } (cookies = session + device). */
async function studentLogin(t: Tenant, email: string, deviceCookie?: string) {
  const headers = new Headers({ host: host(t) });
  if (deviceCookie) headers.set("cookie", deviceCookie);
  try {
    const res = await auth.api.signInStudent({
      body: { email, password: PASSWORD },
      headers,
      returnHeaders: true,
    });
    return { status: 200, code: undefined, cookies: cookiesOf(res.headers) };
  } catch (e) {
    const err = e as APIError;
    return { status: err.statusCode, code: (err.body as { code?: string })?.code, cookies: "" };
  }
}

/** Staff member signed in through the stock sign-in; returns their cookie. */
async function staff(t: Tenant, role: "teacher" | "assistant" = "teacher") {
  const { user } = await fx.member(t.id, role);
  const res = await auth.api.signInEmail({
    body: { email: user.email, password: PASSWORD },
    returnHeaders: true,
  });
  return { user, cookie: cookiesOf(res.headers) };
}

let ipCounter = 0;
const studentPost = (t: Tenant, path: string, email: string, cookie?: string) =>
  http.send(
    host(t),
    "POST",
    path,
    { email, password: PASSWORD },
    {
      "x-forwarded-for": `192.0.2.${++ipCounter}`,
      ...(cookie ? { cookie } : {}),
    },
  );

const list = (t: Tenant, cookie: string, query = "") =>
  http.send(host(t), "GET", `/api/support-requests${query}`, undefined, { cookie });
const decide = (t: Tenant, cookie: string, id: string, verdict: "approve" | "reject") =>
  http.send(host(t), "POST", `/api/support-requests/${id}/${verdict}`, undefined, { cookie });
const me = (t: Tenant, cookie: string) =>
  http.send(host(t), "GET", "/api/me", undefined, { cookie });

type ListBody = {
  items: {
    id: string;
    type: string;
    status: string;
    student: { membershipId: string; name: string; email: string };
    pendingDevice: { id: string; userAgent: string | null } | null;
  }[];
  nextCursor: string | null;
};

/** Open device_change request from a fresh browser of a student at the device limit. */
async function deviceRequest(t: Tenant, opts: { maxDevices?: number } = {}) {
  const { user, membership } = await fx.member(t.id, "student", opts);
  for (let i = 0; i < (opts.maxDevices ?? 1); i++) await fx.device(user.id);
  const res = await studentPost(t, "/api/device-requests", user.email);
  const pendingCookie = res.setCookie!.find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`))!;
  return {
    user,
    membership,
    requestId: (res.body as { requestId: string }).requestId,
    pendingCookie: pendingCookie.split(";")[0]!,
  };
}

describe("full flows with separate sessions (FR-D03, FR-D05, FR-D06)", () => {
  it("device change: blocked browser → request → teacher approves → new browser signs in", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const { user } = await fx.member(t.id);

    const browser1 = await studentLogin(t, user.email);
    expect(browser1.status).toBe(200);
    expect((await me(t, browser1.cookies)).status).toBe(200);

    expect(await studentLogin(t, user.email)).toMatchObject({
      code: AccessReasonCode.DEVICE_LIMIT,
    });
    const asked = await studentPost(t, "/api/device-requests", user.email);
    expect(asked.status).toBe(201);
    const requestId = (asked.body as { requestId: string }).requestId;
    const pendingCookie = asked
      .setCookie!.find((c) => c.startsWith(`${DEVICE_COOKIE_NAME}=`))!
      .split(";")[0]!;

    const open = await list(t, teacher.cookie, "?status=open");
    expect(open.status).toBe(200);
    const item = (open.body as ListBody).items.find((i) => i.id === requestId);
    expect(item).toMatchObject({
      type: "device_change",
      status: "open",
      student: { email: user.email },
    });
    expect(item?.pendingDevice).not.toBeNull();

    expect((await decide(t, teacher.cookie, requestId, "approve")).status).toBe(200);

    // Browser 1: its session is gone and its device is revoked.
    expect((await me(t, browser1.cookies)).status).toBe(401);
    expect(await studentLogin(t, user.email, deviceCookieOf(browser1.cookies))).toMatchObject({
      code: AccessReasonCode.DEVICE_LIMIT,
    });

    // Browser 2: the pending device is now active, so it signs in and uses the API.
    const browser2 = await studentLogin(t, user.email, pendingCookie);
    expect(browser2.status).toBe(200);
    expect((await me(t, browser2.cookies)).status).toBe(200);
  });

  it("sign-out: blocked browser → request → teacher approves → the other session ends → signs in", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const { user } = await fx.member(t.id, "student", { maxDevices: 2 });

    const browser1 = await studentLogin(t, user.email);
    expect(await studentLogin(t, user.email)).toMatchObject({
      code: AccessReasonCode.SESSION_ON_OTHER_DEVICE,
    });
    const asked = await studentPost(t, "/api/signout-requests", user.email);
    expect(asked.status).toBe(201);

    const requestId = (asked.body as { requestId: string }).requestId;
    expect((await decide(t, teacher.cookie, requestId, "approve")).status).toBe(200);

    expect((await me(t, browser1.cookies)).status).toBe(401);
    const browser2 = await studentLogin(t, user.email);
    expect(browser2.status).toBe(200);
    expect((await me(t, browser2.cookies)).status).toBe(200);
    // Devices stay registered: browser 1's device is still active.
    expect(await systemPrisma.device.count({ where: { userId: user.id, status: "active" } })).toBe(
      2,
    );
  });
});

describe("POST /api/support-requests/:id/approve and /reject", () => {
  it("reject: the request closes and the pending device's cookie is dead", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const r = await deviceRequest(t);

    const res = await decide(t, teacher.cookie, r.requestId, "reject");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: r.requestId, status: "rejected" });
    const row = await systemPrisma.supportRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    expect(row).toMatchObject({ status: "rejected", decidedById: teacher.user.id });
    expect(row.decidedAt).not.toBeNull();
    const pending = await systemPrisma.device.findUniqueOrThrow({
      where: { id: row.pendingDeviceId! },
    });
    expect(pending.status).toBe("revoked");
    expect(await studentLogin(t, r.user.email, r.pendingCookie)).toMatchObject({
      code: AccessReasonCode.DEVICE_LIMIT,
    });
  });

  it("with max_devices 2, approval revokes only the least recently used device", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const r = await deviceRequest(t, { maxDevices: 2 });
    const [older, newer] = await systemPrisma.device.findMany({
      where: { userId: r.user.id, status: "active" },
      orderBy: { createdAt: "asc" },
    });
    await systemPrisma.device.update({
      where: { id: older!.id },
      data: { lastSeenAt: new Date(Date.now() - 86_400_000) },
    });
    await systemPrisma.device.update({
      where: { id: newer!.id },
      data: { lastSeenAt: new Date() },
    });

    expect((await decide(t, teacher.cookie, r.requestId, "approve")).status).toBe(200);
    const after = await systemPrisma.device.findMany({ where: { userId: r.user.id } });
    const statusOf = (id: string) => after.find((d) => d.id === id)?.status;
    expect(statusOf(older!.id)).toBe("revoked");
    expect(statusOf(newer!.id)).toBe("active");
    expect(after.filter((d) => d.status === "active")).toHaveLength(2);
  });

  it("only an open request can be decided: the second click gets REQUEST_NOT_OPEN", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const r = await deviceRequest(t);
    const [first, second] = await Promise.all([
      decide(t, teacher.cookie, r.requestId, "approve"),
      decide(t, teacher.cookie, r.requestId, "approve"),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(reasonOf([first, second].find((x) => x.status === 409)!.body)).toBe(
      SupportRequestReason.REQUEST_NOT_OPEN,
    );
    const reject = await decide(t, teacher.cookie, r.requestId, "reject");
    expect(reasonOf(reject.body)).toBe(SupportRequestReason.REQUEST_NOT_OPEN);
  });

  it("a device change whose pending device is gone is REQUEST_STALE", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const r = await deviceRequest(t);
    const row = await systemPrisma.supportRequest.findUniqueOrThrow({ where: { id: r.requestId } });
    await systemPrisma.device.update({
      where: { id: row.pendingDeviceId! },
      data: { status: "revoked" },
    });
    const res = await decide(t, teacher.cookie, r.requestId, "approve");
    expect(res.status).toBe(409);
    expect(reasonOf(res.body)).toBe(SupportRequestReason.REQUEST_STALE);
    expect(
      (await systemPrisma.supportRequest.findUniqueOrThrow({ where: { id: r.requestId } })).status,
    ).toBe("open");
  });

  it("writes an audit entry for every decision", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const a = await deviceRequest(t);
    const b = await deviceRequest(t);
    await decide(t, teacher.cookie, a.requestId, "approve");
    await decide(t, teacher.cookie, b.requestId, "reject");
    const entries = await systemPrisma.auditLog.findMany({
      where: { tenantId: t.id, targetId: { in: [a.requestId, b.requestId] } },
    });
    expect(entries.map((e) => e.action).sort()).toEqual([
      "support_request.approve",
      "support_request.reject",
    ]);
    expect(entries.every((e) => e.actorUserId === teacher.user.id)).toBe(true);
  });

  it("an assistant can decide; a student cannot", async () => {
    const t = await fx.tenant();
    const assistant = await staff(t, "assistant");
    const r = await deviceRequest(t);
    expect((await decide(t, assistant.cookie, r.requestId, "approve")).status).toBe(200);

    const { user } = await fx.member(t.id);
    const student = await studentLogin(t, user.email);
    const res = await list(t, student.cookies);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
  });

  it("an id that is not a uuid is 400; an unknown id is 404", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    expect((await decide(t, teacher.cookie, "not-a-uuid", "approve")).status).toBe(400);
    const unknown = "01936d5e-7c1a-7b2c-9d3e-4f5a6b7c8d9e";
    expect((await decide(t, teacher.cookie, unknown, "approve")).status).toBe(404);
  });
});

describe("GET /api/support-requests", () => {
  it("filters by status and type and pages newest first", async () => {
    const t = await fx.tenant();
    const teacher = await staff(t);
    const { membership } = await fx.member(t.id);
    const make = (type: "device_change" | "sign_out_other" | "general") =>
      systemPrisma.supportRequest.create({
        data: { tenantId: t.id, membershipId: membership.id, type },
      });
    const first = await make("general");
    const second = await make("sign_out_other");
    const third = await make("general");
    await systemPrisma.supportRequest.update({
      where: { id: first.id },
      data: { status: "closed" },
    });

    const page1 = (await list(t, teacher.cookie, "?limit=2")).body as ListBody;
    expect(page1.items.map((i) => i.id)).toEqual([third.id, second.id]);
    expect(page1.nextCursor).toBe(second.id);
    const page2 = (await list(t, teacher.cookie, `?limit=2&cursor=${page1.nextCursor}`))
      .body as ListBody;
    expect(page2.items.map((i) => i.id)).toEqual([first.id]);
    expect(page2.nextCursor).toBeNull();

    const open = (await list(t, teacher.cookie, "?status=open")).body as ListBody;
    expect(open.items.map((i) => i.id)).toEqual([third.id, second.id]);
    const signOuts = (await list(t, teacher.cookie, "?type=sign_out_other")).body as ListBody;
    expect(signOuts.items.map((i) => i.id)).toEqual([second.id]);
    expect((await list(t, teacher.cookie, "?limit=500")).status).toBe(400);
  });
});

describe("support requests: tenant isolation", () => {
  it("tenant A staff cannot see, approve or reject tenant B's requests", async () => {
    const [a, b] = [await fx.tenant(), await fx.tenant()];
    const teacherA = await staff(a);
    const rB = await deviceRequest(b);

    const seen = (await list(a, teacherA.cookie)).body as ListBody;
    expect(seen.items.find((i) => i.id === rB.requestId)).toBeUndefined();
    expect((await decide(a, teacherA.cookie, rB.requestId, "approve")).status).toBe(404);
    expect((await decide(a, teacherA.cookie, rB.requestId, "reject")).status).toBe(404);

    const row = await systemPrisma.supportRequest.findUniqueOrThrow({
      where: { id: rB.requestId },
    });
    expect(row.status).toBe("open");
    const pending = await systemPrisma.device.findUniqueOrThrow({
      where: { id: row.pendingDeviceId! },
    });
    expect(pending.status).toBe("pending");
  });

  it("tenant A staff using their cookie on tenant B's host get NO_ACCESS", async () => {
    const [a, b] = [await fx.tenant(), await fx.tenant()];
    const teacherA = await staff(a);
    const res = await list(b, teacherA.cookie);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.NO_ACCESS);
  });
});
