import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, describe, expect, it } from "vitest";
import { auth, AUTH_VERSION } from "./index.js";

const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await systemPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await systemPrisma.$disconnect();
});

describe("Better Auth with Prisma adapter (integration)", () => {
  it("exports package version and auth instance", () => {
    expect(AUTH_VERSION).toBe("0.1.0");
    expect(auth).toBeDefined();
    expect(auth.handler).toBeTypeOf("function");
    expect(auth.api).toBeDefined();
  });

  it("creates a user with email and password, setting domain defaults", async () => {
    const email = `auth-test-${randomUUID().slice(0, 8)}@example.com`;
    const result = await auth.api.signUpEmail({
      body: {
        email,
        password: "StrongPassword123!",
        name: "Auth Test User",
      },
    });

    expect(result).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe(email);
    expect(result.user.name).toBe("Auth Test User");
    createdUserIds.push(result.user.id);

    // Verify database row directly via systemPrisma
    const dbUser = await systemPrisma.user.findUnique({
      where: { id: result.user.id },
      include: { accounts: true },
    });

    expect(dbUser).not.toBeNull();
    expect(dbUser!.email).toBe(email);
    expect(dbUser!.maxDevices).toBe(1);
    expect(dbUser!.status).toBe("active");
    expect(dbUser!.isSuperAdmin).toBe(false);
    expect(dbUser!.accounts.length).toBe(1);
    expect(dbUser!.accounts[0].providerId).toBe("credential");
    expect(dbUser!.accounts[0].password).not.toBe("StrongPassword123!");
  });
});
