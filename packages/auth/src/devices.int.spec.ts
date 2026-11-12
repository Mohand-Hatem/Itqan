import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "./auth.js";
import { createDeviceSecret, hashDeviceSecret, verifyDeviceSecret } from "./device-cookie.js";

let userId: string;
let tenantId: string;

beforeAll(async () => {
  const user = await systemPrisma.user.create({
    data: { email: `device-${randomUUID().slice(0, 8)}@example.com`, name: "Device Test" },
  });
  const tenant = await systemPrisma.tenant.create({
    data: { slug: `device-${randomUUID().slice(0, 8)}`, name: "Device Test Tenant" },
  });
  userId = user.id;
  tenantId = tenant.id;
});

afterAll(async () => {
  await systemPrisma.user.deleteMany({ where: { id: userId } });
  await systemPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await systemPrisma.$disconnect();
});

describe("devices table and session fields (step 5.2)", () => {
  it("stores only the secret hash, which verifies the original secret", async () => {
    const secret = createDeviceSecret();
    const device = await systemPrisma.device.create({
      data: { userId, secretHash: hashDeviceSecret(secret), userAgent: "vitest" },
    });
    expect(device.status).toBe("active");
    expect(device.secretHash).not.toContain(secret);
    expect(verifyDeviceSecret(secret, device.secretHash)).toBe(true);
  });

  it("Better Auth writes and returns deviceId and tenantId on a session", async () => {
    const device = await systemPrisma.device.create({
      data: { userId, secretHash: hashDeviceSecret(createDeviceSecret()) },
    });
    const ctx = await auth.$context;
    const session = await ctx.internalAdapter.createSession(userId, false, {
      deviceId: device.id,
      tenantId,
    });

    const row = await systemPrisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.deviceId).toBe(device.id);
    expect(row.tenantId).toBe(tenantId);

    const found = await ctx.internalAdapter.findSession(session.token);
    expect(found?.session).toMatchObject({ deviceId: device.id, tenantId });
  });

  it("deleting a device deletes its sessions; staff sessions need no device", async () => {
    const device = await systemPrisma.device.create({
      data: { userId, secretHash: hashDeviceSecret(createDeviceSecret()) },
    });
    const ctx = await auth.$context;
    const bound = await ctx.internalAdapter.createSession(userId, false, { deviceId: device.id });
    const staff = await ctx.internalAdapter.createSession(userId, false);

    await systemPrisma.device.delete({ where: { id: device.id } });
    expect(await systemPrisma.session.findUnique({ where: { id: bound.id } })).toBeNull();
    const staffRow = await systemPrisma.session.findUniqueOrThrow({ where: { id: staff.id } });
    expect(staffRow.deviceId).toBeNull();
    expect(staffRow.tenantId).toBeNull();
  });
});
