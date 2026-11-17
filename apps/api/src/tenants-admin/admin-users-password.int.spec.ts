// 10R.3 (FR-A07): only the super admin sets another user's password; never a super admin's.
import { auth } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, PASSWORD_TOO_SHORT } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("AdminResetPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
const adminIds: string[] = [];

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  // Super admin audit rows carry no tenant, so they go before their actors (test cleanup only).
  await systemPrisma.auditLog.deleteMany({ where: { actorUserId: { in: adminIds } } });
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;

async function superAdmin() {
  const t = await fx.tenant();
  const admin = await fx.staffLogin(t, "teacher", { superAdmin: true });
  adminIds.push(admin.user.id);
  return {
    ...admin,
    reset: (userId: string, newPassword: string, cookie = admin.cookie) =>
      http.send("admin.localhost", "POST", `/api/admin/users/${userId}/password`, { newPassword }, {
        cookie,
      }),
  };
}

describe("POST /api/admin/users/:id/password (FR-A07)", () => {
  it("sets a staff password of 12+ characters, ends every session and forces a change", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");

    const short = await admin.reset(teacher.user.id, "Elevenchar1");
    expect(short.status).toBe(400);
    expect(reasonOf(short.body)).toBe(PASSWORD_TOO_SHORT);

    const res = await admin.reset(teacher.user.id, "BrandNewPass12");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sessionsEnded: 1 });

    const row = await systemPrisma.user.findUniqueOrThrow({ where: { id: teacher.user.id } });
    expect(row.mustChangePassword).toBe(true);
    const oldSession = await http.send(`${t.slug}.localhost`, "GET", "/api/me", undefined, {
      cookie: teacher.cookie,
    });
    expect(oldSession.status).toBe(401);
    await expect(
      auth.api.signInEmail({ body: { email: teacher.user.email, password: "BrandNewPass12" } }),
    ).resolves.toMatchObject({ user: { id: teacher.user.id } });

    const audit = await systemPrisma.auditLog.findFirstOrThrow({
      where: { action: "user.password_reset_by_admin", targetId: teacher.user.id },
    });
    expect(audit.actorUserId).toBe(admin.user.id);
    expect(audit.meta).toEqual({ sessionsEnded: 1 });
    expect(JSON.stringify(audit)).not.toContain("BrandNewPass12");
  });

  it("accepts an 8-character student password", async () => {
    const admin = await superAdmin();
    const t = await fx.tenant();
    const { user } = await fx.member(t.id, "student");
    expect((await admin.reset(user.id, "Eight888")).status).toBe(200);
  });

  it("refuses a super admin target and every non-super-admin caller", async () => {
    const admin = await superAdmin();
    const other = await superAdmin();
    const asTarget = await admin.reset(other.user.id, "BrandNewPass12");
    expect(asTarget.status).toBe(403);
    expect(reasonOf(asTarget.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");
    const { user: student } = await fx.member(t.id, "student");
    const byTeacher = await admin.reset(student.id, "Eight888", teacher.cookie);
    expect(byTeacher.status).toBe(403);
  });
});
