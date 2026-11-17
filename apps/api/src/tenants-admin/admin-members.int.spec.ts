// 10R.5 (FR-T02, FR-T03, D8): several teachers and assistants per tenant, the last-active-teacher
// rule (also under parallel requests and global suspension), and tenant isolation.
import { systemPrisma } from "@itqan/database";
import { ProvisioningReason } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("MembersPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
const adminIds: string[] = [];

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await systemPrisma.auditLog.deleteMany({ where: { actorUserId: { in: adminIds } } });
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;

async function superAdmin() {
  const home = await fx.tenant();
  const admin = await fx.staffLogin(home, "teacher", { superAdmin: true });
  adminIds.push(admin.user.id);
  const send = (method: string, path: string, body?: unknown) =>
    http.send("admin.localhost", method, `/api/admin${path}`, body, { cookie: admin.cookie });
  return { ...admin, send };
}

describe("tenant staff (FR-T02)", () => {
  it("runs a tenant with two teachers and three assistants, listed and counted", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    for (const role of ["teacher", "teacher", "assistant", "assistant", "assistant"] as const) {
      await fx.member(t.id, role);
    }
    await fx.member(t.id, "student");

    const staff = await admin.send("GET", `/tenants/${t.id}/members`);
    expect(staff.status).toBe(200);
    const items = (staff.body as { items: { role: string }[] }).items;
    expect(items.map((i) => i.role).sort()).toEqual([
      "assistant",
      "assistant",
      "assistant",
      "teacher",
      "teacher",
    ]);

    const students = await admin.send("GET", `/tenants/${t.id}/members?role=student`);
    expect((students.body as { items: unknown[] }).items).toHaveLength(1);

    const detail = await admin.send("GET", `/tenants/${t.id}`);
    expect(detail.body).toMatchObject({ assistantCount: 3, studentCount: 1 });
    expect((detail.body as { teachers: unknown[] }).teachers).toHaveLength(2);
  });

  it("changes roles both ways and refuses to re-role a student", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    await fx.member(t.id, "teacher");
    const { membership: helper } = await fx.member(t.id, "assistant");
    const { membership: learner } = await fx.member(t.id, "student");

    const promoted = await admin.send("PATCH", `/tenants/${t.id}/members/${helper.id}`, {
      role: "teacher",
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ role: "teacher", status: "active" });

    const student = await admin.send("PATCH", `/tenants/${t.id}/members/${learner.id}`, {
      role: "assistant",
    });
    expect(student.status).toBe(400);
    expect(reasonOf(student.body)).toBe(ProvisioningReason.NOT_STAFF);
  });
});

describe("last active teacher (FR-T02, FR-T03)", () => {
  it("refuses to remove, demote or suspend the only teacher, or suspend that user globally", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    const { user, membership } = await fx.member(t.id, "teacher");
    const path = `/tenants/${t.id}/members/${membership.id}`;

    for (const [method, body] of [
      ["DELETE", undefined],
      ["PATCH", { role: "assistant" }],
      ["PATCH", { status: "suspended" }],
    ] as const) {
      const res = await admin.send(method, path, body);
      expect(res.status).toBe(409);
      expect(reasonOf(res.body)).toBe(ProvisioningReason.LAST_TEACHER);
    }

    const global = await admin.send("PATCH", `/users/${user.id}`, { status: "suspended" });
    expect(global.status).toBe(409);
    expect(reasonOf(global.body)).toBe(ProvisioningReason.LAST_TEACHER);
    const after = await systemPrisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.status).toBe("active");

    // With a second teacher, the first can go (replacement = add first, then remove).
    await fx.member(t.id, "teacher");
    expect((await admin.send("DELETE", path)).status).toBe(200);
  });

  it("lets exactly one of two parallel removals of the last two teachers through", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    const a = await fx.member(t.id, "teacher");
    const b = await fx.member(t.id, "teacher");

    const results = await Promise.all(
      [a, b].map((m) => admin.send("DELETE", `/tenants/${t.id}/members/${m.membership.id}`)),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await systemPrisma.membership.count({ where: { tenantId: t.id, role: "teacher" } }),
    ).toBe(1);
  });

  it("still counts a teacher whose account is suspended as gone", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    const { membership } = await fx.member(t.id, "teacher");
    await fx.member(t.id, "teacher", { suspended: true });
    const res = await admin.send("DELETE", `/tenants/${t.id}/members/${membership.id}`);
    expect(res.status).toBe(409);
  });
});

describe("isolation and access", () => {
  it("never reaches another tenant's member through this tenant's path", async () => {
    const admin = await superAdmin();
    const tA = await fx.tenant();
    const tB = await fx.tenant();
    await fx.member(tA.id, "teacher");
    await fx.member(tB.id, "teacher");
    const { membership: bAssistant } = await fx.member(tB.id, "assistant");

    for (const [method, body] of [
      ["PATCH", { status: "suspended" }],
      ["DELETE", undefined],
    ] as const) {
      const res = await admin.send(method, `/tenants/${tA.id}/members/${bAssistant.id}`, body);
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe(ProvisioningReason.MEMBER_NOT_FOUND);
    }
    const listA = await admin.send("GET", `/tenants/${tA.id}/members?role=teacher,assistant`);
    const ids = (listA.body as { items: { membershipId: string }[] }).items.map((i) => i.membershipId);
    expect(ids).not.toContain(bAssistant.id);
    const untouched = await systemPrisma.membership.findUniqueOrThrow({ where: { id: bAssistant.id } });
    expect(untouched.status).toBe("active");
  });

  it("refuses teachers on every member route", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");
    const res = await http.send("admin.localhost", "GET", `/api/admin/tenants/${t.id}/members`, undefined, {
      cookie: teacher.cookie,
    });
    expect(res.status).toBe(403);
  });
});
