// Step 5.10a: GET /api/me/devices, a student lists their own devices (docs/07-api.md).
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, type MyDevicesResponse } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "MyDevicesPassword123!";
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

const list = (slug: string, cookie?: string) =>
  http.send(`${slug}.localhost`, "GET", "/api/me/devices", undefined, cookie ? { cookie } : {});
const itemsOf = (body: unknown) => (body as MyDevicesResponse).items;

describe("GET /api/me/devices", () => {
  it("returns only the caller's active and pending devices, newest first, current marked", async () => {
    const t = await fx.tenant();
    const { user } = await fx.member(t.id, "student", { maxDevices: 3 });
    const old = await fx.device(user.id);
    const revoked = await fx.device(user.id);
    await systemPrisma.device.update({
      where: { id: revoked.device.id },
      data: { status: "revoked", revokedAt: new Date() },
    });
    const browser = await fx.studentLogin(t, user.email);
    expect(browser.status).toBe(200);
    const pending = await fx.device(user.id, "pending");
    // Another student of the same tenant: never shown.
    const { user: other } = await fx.member(t.id);
    await fx.device(other.id);

    const res = await list(t.slug, browser.cookies);
    expect(res.status).toBe(200);
    const items = itemsOf(res.body);
    const [current] = await systemPrisma.session.findMany({ where: { userId: user.id } });

    expect(items.map((d) => d.id)).toEqual([pending.device.id, current!.deviceId, old.device.id]);
    expect(items.map((d) => d.status)).toEqual(["pending", "active", "active"]);
    expect(items.filter((d) => d.current).map((d) => d.id)).toEqual([current!.deviceId]);
    expect(items[1]!.userAgent).toBeNull();
    for (const d of items) {
      expect(Object.keys(d).sort()).toEqual(
        ["createdAt", "current", "id", "lastSeenAt", "name", "status", "userAgent"].sort(),
      );
    }
  });

  it("returns the same list on another tenant's subdomain (devices belong to the user)", async () => {
    const [a, b] = [await fx.tenant(), await fx.tenant()];
    const { user } = await fx.member(a.id);
    await systemPrisma.membership.create({
      data: { userId: user.id, tenantId: b.id, role: "student" },
    });
    const onA = await fx.studentLogin(a, user.email);
    const onB = await fx.studentLogin(b, user.email, onA.cookies);
    expect(onB.status).toBe(200);

    const fromA = itemsOf((await list(a.slug, onA.cookies)).body);
    const fromB = itemsOf((await list(b.slug, onB.cookies)).body);
    expect(fromA).toHaveLength(1);
    expect(fromB).toEqual(fromA);
  });

  it("staff get ROLE_FORBIDDEN and an anonymous call gets 401", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t);
    const res = await list(t.slug, teacher.cookie);
    expect(res.status).toBe(403);
    expect((res.body as { reason?: string }).reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    expect((await list(t.slug)).status).toBe(401);
  });
});
