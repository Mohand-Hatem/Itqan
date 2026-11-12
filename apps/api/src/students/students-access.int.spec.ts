// Step 5.9: staff actions on a student's access (docs/05-auth-devices.md §7, FR-D02, FR-D06).
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "StaffActionsPassword123!";
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
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const as = (t: Tenant, cookie: string, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body, { cookie });
const me = (t: Tenant, cookie: string) => as(t, cookie, "GET", "/me");
const auditOf = (tenantId: string, targetId: string) =>
  systemPrisma.auditLog.findMany({ where: { tenantId, targetId } });

describe("POST /api/devices/:id/revoke", () => {
  it("revokes the device, ends its sessions and leaves other devices alone", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t);
    const { user } = await fx.member(t.id, "student", { maxDevices: 2 });
    const browser = await fx.studentLogin(t, user.email);
    expect((await me(t, browser.cookies)).status).toBe(200);
    const other = await fx.device(user.id);
    const [bound] = await systemPrisma.session.findMany({ where: { userId: user.id } });

    const res = await as(t, teacher.cookie, "POST", `/devices/${bound!.deviceId}/revoke`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: bound!.deviceId, status: "revoked" });

    expect((await me(t, browser.cookies)).status).toBe(401);
    const device = await systemPrisma.device.findUniqueOrThrow({ where: { id: bound!.deviceId! } });
    expect(device.status).toBe("revoked");
    expect(device.revokedAt).not.toBeNull();
    expect(
      (await systemPrisma.device.findUniqueOrThrow({ where: { id: other.device.id } })).status,
    ).toBe("active");
    const [entry] = await auditOf(t.id, bound!.deviceId!);
    expect(entry).toMatchObject({ action: "device.revoke", actorUserId: teacher.user.id });
  });

  it("a super admin can revoke too", async () => {
    const t = await fx.tenant();
    const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });
    const { user } = await fx.member(t.id);
    const { device } = await fx.device(user.id);
    expect((await as(t, admin.cookie, "POST", `/devices/${device.id}/revoke`)).status).toBe(200);
  });
});

describe("POST /api/students/:membershipId/force-signout", () => {
  it("ends every session of the student; devices stay registered", async () => {
    const [t, other] = [await fx.tenant(), await fx.tenant()];
    const assistant = await fx.staffLogin(t, "assistant");
    const { user, membership } = await fx.member(t.id, "student", { maxDevices: 2 });
    const d1 = await fx.device(user.id);
    const d2 = await fx.device(user.id);
    await fx.session(user.id, d1.device.id, t.id);
    await fx.session(user.id, d2.device.id, other.id);

    const res = await as(t, assistant.cookie, "POST", `/students/${membership.id}/force-signout`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ membershipId: membership.id, sessionsEnded: 2 });
    expect(await systemPrisma.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await systemPrisma.device.count({ where: { userId: user.id, status: "active" } })).toBe(
      2,
    );
    const [entry] = await auditOf(t.id, membership.id);
    expect(entry).toMatchObject({
      action: "student.force_signout",
      actorUserId: assistant.user.id,
    });
  });
});

describe("PATCH /api/students/:membershipId", () => {
  it("suspend ends this tenant's sessions only; reactivate lets the student back in", async () => {
    const [t, other] = [await fx.tenant(), await fx.tenant()];
    const teacher = await fx.staffLogin(t);
    const { user, membership } = await fx.member(t.id);
    await systemPrisma.membership.create({
      data: { userId: user.id, tenantId: other.id, role: "student" },
    });
    const d = await fx.device(user.id);
    await fx.session(user.id, d.device.id, t.id);
    const kept = await fx.session(user.id, d.device.id, other.id);

    const suspend = await as(t, teacher.cookie, "PATCH", `/students/${membership.id}`, {
      status: "suspended",
    });
    expect(suspend.status).toBe(200);
    expect(suspend.body).toMatchObject({ membershipId: membership.id, status: "suspended" });
    const left = await systemPrisma.session.findMany({ where: { userId: user.id } });
    expect(left.map((s) => s.id)).toEqual([kept.id]);
    expect(await fx.studentLogin(t, user.email, d.cookie)).toMatchObject({
      code: AccessReasonCode.NO_ACCESS,
    });

    const back = await as(t, teacher.cookie, "PATCH", `/students/${membership.id}`, {
      status: "active",
    });
    expect(back.body).toMatchObject({ status: "active" });
    expect((await fx.studentLogin(t, user.email, d.cookie)).status).toBe(200);

    const actions = (await auditOf(t.id, membership.id)).map((e) => e.action).sort();
    expect(actions).toEqual(["student.reactivate", "student.suspend"]);
  });

  it("the teacher changes max_devices; lowering it revokes nothing", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t);
    const { user, membership } = await fx.member(t.id, "student", { maxDevices: 3 });
    for (let i = 0; i < 3; i++) await fx.device(user.id);

    const res = await as(t, teacher.cookie, "PATCH", `/students/${membership.id}`, {
      maxDevices: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ maxDevices: 1 });
    expect((await systemPrisma.user.findUniqueOrThrow({ where: { id: user.id } })).maxDevices).toBe(
      1,
    );
    expect(await systemPrisma.device.count({ where: { userId: user.id, status: "active" } })).toBe(
      3,
    );
    const [entry] = await auditOf(t.id, membership.id);
    expect(entry).toMatchObject({ action: "student.max_devices", actorUserId: teacher.user.id });
    expect(entry!.meta).toMatchObject({ from: 3, to: 1 });
  });

  it("an assistant may suspend but not change max_devices (FR-D02)", async () => {
    const t = await fx.tenant();
    const assistant = await fx.staffLogin(t, "assistant");
    const { user, membership } = await fx.member(t.id);
    const denied = await as(t, assistant.cookie, "PATCH", `/students/${membership.id}`, {
      maxDevices: 2,
    });
    expect(denied.status).toBe(403);
    expect(reasonOf(denied.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    expect((await systemPrisma.user.findUniqueOrThrow({ where: { id: user.id } })).maxDevices).toBe(
      1,
    );

    const ok = await as(t, assistant.cookie, "PATCH", `/students/${membership.id}`, {
      status: "suspended",
    });
    expect(ok.status).toBe(200);
  });

  it("rejects a bad body with 400", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t);
    const { membership } = await fx.member(t.id);
    for (const body of [
      {},
      { maxDevices: 0 },
      { maxDevices: 11 },
      { status: "deleted" },
      { role: "teacher" },
    ]) {
      expect(
        (await as(t, teacher.cookie, "PATCH", `/students/${membership.id}`, body)).status,
      ).toBe(400);
    }
  });
});

describe("staff actions: who and what can be targeted", () => {
  it("a staff membership cannot be targeted (404)", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t);
    const { membership } = await fx.member(t.id, "assistant");
    expect(
      (await as(t, teacher.cookie, "POST", `/students/${membership.id}/force-signout`)).status,
    ).toBe(404);
    expect(
      (await as(t, teacher.cookie, "PATCH", `/students/${membership.id}`, { status: "suspended" }))
        .status,
    ).toBe(404);
  });

  it("a student calling these gets ROLE_FORBIDDEN", async () => {
    const t = await fx.tenant();
    const { user, membership } = await fx.member(t.id);
    const browser = await fx.studentLogin(t, user.email);
    const res = await as(t, browser.cookies, "POST", `/students/${membership.id}/force-signout`);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
  });
});

describe("staff actions: tenant isolation", () => {
  it("tenant A staff cannot touch tenant B's devices or memberships, and nothing changes", async () => {
    const [a, b] = [await fx.tenant(), await fx.tenant()];
    const teacherA = await fx.staffLogin(a);
    const { user, membership } = await fx.member(b.id);
    const { device } = await fx.device(user.id);
    await fx.session(user.id, device.id, b.id);

    expect((await as(a, teacherA.cookie, "POST", `/devices/${device.id}/revoke`)).status).toBe(404);
    expect(
      (await as(a, teacherA.cookie, "POST", `/students/${membership.id}/force-signout`)).status,
    ).toBe(404);
    expect(
      (await as(a, teacherA.cookie, "PATCH", `/students/${membership.id}`, { status: "suspended" }))
        .status,
    ).toBe(404);

    expect((await systemPrisma.device.findUniqueOrThrow({ where: { id: device.id } })).status).toBe(
      "active",
    );
    expect(await systemPrisma.session.count({ where: { userId: user.id } })).toBe(1);
    expect(
      (await systemPrisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).status,
    ).toBe("active");
  });
});
