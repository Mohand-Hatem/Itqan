import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, getLastSentEmail, isStaffOrSuperAdmin } from "./index.js";

const createdUserIds: string[] = [];
let tenantId: string;

beforeAll(async () => {
  const tenant = await systemPrisma.tenant.create({
    data: { slug: `staff-test-${randomUUID().slice(0, 8)}`, name: "Staff Test Tenant" },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await systemPrisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
    await systemPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  if (tenantId) await systemPrisma.tenant.delete({ where: { id: tenantId } });
  await systemPrisma.$disconnect();
});

async function userWithRole(role: "teacher" | "assistant" | "student" | null, isSuperAdmin = false) {
  const user = await systemPrisma.user.create({
    data: {
      email: `${role ?? "admin"}-${randomUUID().slice(0, 8)}@example.com`,
      name: "Test User",
      emailVerified: true,
      isSuperAdmin,
    },
  });
  createdUserIds.push(user.id);
  if (role) await systemPrisma.membership.create({ data: { userId: user.id, tenantId, role } });
  return user;
}

describe("staff accounts (ADR-012)", () => {
  it("counts teachers, assistants and super admins as staff, not students", async () => {
    expect(await isStaffOrSuperAdmin((await userWithRole("student")).id)).toBe(false);
    expect(await isStaffOrSuperAdmin((await userWithRole("teacher")).id)).toBe(true);
    expect(await isStaffOrSuperAdmin((await userWithRole("assistant")).id)).toBe(true);
    const admin = await userWithRole(null, true);
    expect(await isStaffOrSuperAdmin(admin.id)).toBe(true);
    expect(await isStaffOrSuperAdmin(admin.id, admin)).toBe(true);
  });

  it("signs a teacher in with email and password only, with no second-factor step", async () => {
    const email = `staff-login-${randomUUID().slice(0, 8)}@example.com`;
    const password = "StrongStaffPassword123!";
    const signUp = await auth.api.signUpEmail({ body: { email, password, name: "Staff Member" } });
    createdUserIds.push(signUp.user.id);
    await auth.api.verifyEmail({ query: { token: getLastSentEmail(email)!.token! } });
    await systemPrisma.membership.create({ data: { userId: signUp.user.id, tenantId, role: "teacher" } });

    const signIn = (await auth.api.signInEmail({ body: { email, password } })) as Record<string, unknown>;

    expect(signIn["token"]).toEqual(expect.any(String));
    expect(signIn).not.toHaveProperty("twoFactorRedirect");
    expect(signIn).not.toHaveProperty("mfaEnrolmentRequired");
  });
});
