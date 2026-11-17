// 10R.3 (FR-A08): while must_change_password is set, only GET /me answers.
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("GatePassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

const reasonOf = (body: unknown) => (body as { reason?: string })?.reason;

describe("password change required (FR-A08)", () => {
  it("answers only GET /me until the password is changed, then everything again", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");
    await systemPrisma.user.update({
      where: { id: teacher.user.id },
      data: { mustChangePassword: true },
    });
    const as = (method: string, path: string, body?: unknown) =>
      http.send(`${t.slug}.localhost`, method, `/api${path}`, body, { cookie: teacher.cookie });

    const me = await as("GET", "/me");
    expect(me.status).toBe(200);
    expect((me.body as { user: { mustChangePassword: boolean } }).user.mustChangePassword).toBe(true);

    const staffRoute = await as("GET", "/students");
    expect(staffRoute.status).toBe(403);
    expect(reasonOf(staffRoute.body)).toBe(AccessReasonCode.PASSWORD_CHANGE_REQUIRED);

    // A public route that acts for the signed-in user is closed too.
    const publicWithSession = await as("POST", "/codes/redeem", { code: "AAAA-BBBB-CCCC" });
    expect(publicWithSession.status).toBe(403);
    expect(reasonOf(publicWithSession.body)).toBe(AccessReasonCode.PASSWORD_CHANGE_REQUIRED);

    await systemPrisma.user.update({
      where: { id: teacher.user.id },
      data: { mustChangePassword: false },
    });
    expect((await as("GET", "/students")).status).toBe(200);
  });
});
