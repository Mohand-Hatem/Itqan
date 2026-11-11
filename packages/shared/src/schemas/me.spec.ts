import { describe, expect, it } from "vitest";
import { computePermissions, MeResponseSchema } from "./me.js";

describe("Permissions and MeResponse Schema", () => {
  it("computes full permissions for super admin", () => {
    const perms = computePermissions(true);
    expect(perms.canManageTenants).toBe(true);
    expect(perms.canManageSettings).toBe(true);
    expect(perms.canManageAssistants).toBe(true);
    expect(perms.canManagePayments).toBe(true);
    expect(perms.canViewPayments).toBe(true);
    expect(perms.canManageCourses).toBe(true);
    expect(perms.canManageStudents).toBe(true);
    expect(perms.canManageDevices).toBe(true);
    expect(perms.canDeleteCourse).toBe(true);
    expect(perms.canLearn).toBe(false);
  });

  it("computes permissions for teacher", () => {
    const perms = computePermissions(false, "teacher");
    expect(perms.canManageTenants).toBe(false);
    expect(perms.canManageSettings).toBe(true);
    expect(perms.canManageAssistants).toBe(true);
    expect(perms.canManagePayments).toBe(true);
    expect(perms.canViewPayments).toBe(true);
    expect(perms.canManageCourses).toBe(true);
    expect(perms.canManageStudents).toBe(true);
    expect(perms.canManageDevices).toBe(true);
    expect(perms.canDeleteCourse).toBe(true);
    expect(perms.canLearn).toBe(false);
  });

  it("computes permissions for assistant", () => {
    const perms = computePermissions(false, "assistant");
    expect(perms.canManageTenants).toBe(false);
    expect(perms.canManageSettings).toBe(false);
    expect(perms.canManageAssistants).toBe(false);
    expect(perms.canManagePayments).toBe(false);
    expect(perms.canViewPayments).toBe(true);
    expect(perms.canManageCourses).toBe(true);
    expect(perms.canManageStudents).toBe(true);
    expect(perms.canManageDevices).toBe(true);
    expect(perms.canDeleteCourse).toBe(false);
    expect(perms.canLearn).toBe(false);
  });

  it("computes permissions for student", () => {
    const perms = computePermissions(false, "student");
    expect(perms.canManageTenants).toBe(false);
    expect(perms.canManageSettings).toBe(false);
    expect(perms.canManageAssistants).toBe(false);
    expect(perms.canManagePayments).toBe(false);
    expect(perms.canViewPayments).toBe(false);
    expect(perms.canManageCourses).toBe(false);
    expect(perms.canManageStudents).toBe(false);
    expect(perms.canManageDevices).toBe(false);
    expect(perms.canDeleteCourse).toBe(false);
    expect(perms.canLearn).toBe(true);
  });

  it("validates a complete MeResponse object", () => {
    const sample = {
      user: {
        id: "019441a0-0000-7000-8000-000000000001",
        email: "test@example.com",
        name: "Test User",
        image: null,
        emailVerified: true,
        isSuperAdmin: false,
        twoFactorEnabled: false,
        status: "active",
        createdAt: new Date().toISOString(),
      },
      tenant: {
        id: "019441a0-0000-7000-8000-000000000002",
        slug: "math",
        name: "Math Academy",
        settings: { theme: "dark" },
      },
      membership: {
        id: "019441a0-0000-7000-8000-000000000003",
        role: "teacher",
        status: "active",
        phone: "+201000000000",
        createdAt: new Date().toISOString(),
      },
      memberships: [
        {
          id: "019441a0-0000-7000-8000-000000000003",
          tenantId: "019441a0-0000-7000-8000-000000000002",
          tenantSlug: "math",
          tenantName: "Math Academy",
          role: "teacher",
          status: "active",
        },
      ],
      permissions: computePermissions(false, "teacher"),
    };

    const parsed = MeResponseSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });
});
