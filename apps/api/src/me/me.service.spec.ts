import { describe, expect, it, vi } from "vitest";
import { type Membership, PrismaClient, runWithContext } from "@itqan/database";
import { MeService } from "./me.service.js";

describe("MeService", () => {
  const mockUser = {
    id: "019441a0-0000-7000-8000-000000000001",
    email: "teacher@example.com",
    name: "Teacher User",
    image: null,
    emailVerified: true,
    isSuperAdmin: false,
    twoFactorEnabled: false,
    status: "active" as const,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  const mockTenant = {
    id: "019441a0-0000-7000-8000-000000000002",
    slug: "math",
    name: "Math Academy",
    settings: { primaryColor: "#003366" },
    status: "active" as const,
  };

  const mockMembership = {
    id: "019441a0-0000-7000-8000-000000000003",
    tenantId: mockTenant.id,
    userId: mockUser.id,
    role: "teacher" as const,
    status: "active" as const,
    phone: "+201234567890",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    tenant: mockTenant,
  };

  it("returns MeResponse for teacher in tenant context", async () => {
    const mockDb = {
      user: {
        findUnique: vi.fn().mockResolvedValue(mockUser),
      },
      membership: {
        findMany: vi.fn().mockResolvedValue([mockMembership]),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue(mockTenant),
      },
    };

    const service = new MeService(mockDb as unknown as PrismaClient);

    const result = await runWithContext(
      {
        kind: "tenant",
        tenantId: mockTenant.id,
        tenantSlug: mockTenant.slug,
        host: "math.localhost",
      },
      () => service.getMe(mockUser.id, mockMembership as unknown as Membership),
    );

    expect(result.user.id).toBe(mockUser.id);
    expect(result.user.email).toBe(mockUser.email);
    expect(result.tenant).toEqual({
      id: mockTenant.id,
      slug: mockTenant.slug,
      name: mockTenant.name,
      settings: mockTenant.settings,
    });
    expect(result.membership?.role).toBe("teacher");
    expect(result.memberships).toHaveLength(1);
    expect(result.permissions.canManageCourses).toBe(true);
    expect(result.permissions.canManageTenants).toBe(false);
    expect(result.permissions.canLearn).toBe(false);
  });

  it("returns MeResponse for super admin in admin context", async () => {
    const adminUser = {
      ...mockUser,
      id: "019441a0-0000-7000-8000-000000000099",
      email: "admin@itqan.test",
      isSuperAdmin: true,
    };

    const mockDb = {
      user: {
        findUnique: vi.fn().mockResolvedValue(adminUser),
      },
      membership: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      tenant: {
        findUnique: vi.fn(),
      },
    };

    const service = new MeService(mockDb as unknown as PrismaClient);

    const result = await runWithContext(
      {
        kind: "admin",
        host: "admin.localhost",
      },
      () => service.getMe(adminUser.id, null),
    );

    expect(result.user.isSuperAdmin).toBe(true);
    expect(result.tenant).toBeNull();
    expect(result.membership).toBeNull();
    expect(result.permissions.canManageTenants).toBe(true);
    expect(result.permissions.canManageCourses).toBe(true);
    expect(result.permissions.canDeleteCourse).toBe(true);
  });

  it("throws UnauthorizedException if user not in db", async () => {
    const mockDb = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const service = new MeService(mockDb as unknown as PrismaClient);
    await expect(service.getMe("non-existent")).rejects.toThrow(
      "User not found",
    );
  });
});
