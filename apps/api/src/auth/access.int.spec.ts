import { randomUUID } from "node:crypto";
import { Controller, Get, Module, Req } from "@nestjs/common";
import { auth, getLastSentEmail } from "@itqan/auth";
import { createTestClient, systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import type { Request } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthController } from "../health/health.controller.js";
import { createHttpTestApp } from "../testing/http.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AuthModule } from "./auth.module.js";
import { Roles, SuperAdminOnly } from "./roles.decorator.js";

// Test-only controller to verify AccessGuard reason codes over HTTP.
class AccessProbeController {
  getMember(req: Request) {
    return { ok: true, role: req.membership?.role, userId: req.user?.id };
  }

  getTeacherOnly(req: Request) {
    return { ok: true, role: req.membership?.role };
  }

  getSuperAdminOnly(req: Request) {
    return { ok: true, isSuperAdmin: req.user?.isSuperAdmin };
  }
}

// Imperative decorator registration for spec files
const memberDesc = Object.getOwnPropertyDescriptor(
  AccessProbeController.prototype,
  "getMember",
)!;
Req()(AccessProbeController.prototype, "getMember", 0);
Get("member")(AccessProbeController.prototype, "getMember", memberDesc);

const teacherDesc = Object.getOwnPropertyDescriptor(
  AccessProbeController.prototype,
  "getTeacherOnly",
)!;
Req()(AccessProbeController.prototype, "getTeacherOnly", 0);
Roles("teacher")(AccessProbeController.prototype, "getTeacherOnly", teacherDesc);
Get("teacher-only")(
  AccessProbeController.prototype,
  "getTeacherOnly",
  teacherDesc,
);

const adminDesc = Object.getOwnPropertyDescriptor(
  AccessProbeController.prototype,
  "getSuperAdminOnly",
)!;
Req()(AccessProbeController.prototype, "getSuperAdminOnly", 0);
SuperAdminOnly()(
  AccessProbeController.prototype,
  "getSuperAdminOnly",
  adminDesc,
);
Get("admin-only")(AccessProbeController.prototype, "getSuperAdminOnly", adminDesc);

Controller("access-test")(AccessProbeController);

class TestAppModule {}
Module({
  imports: [TenancyModule, AuthModule],
  controllers: [HealthController, AccessProbeController],
})(TestAppModule);

const db = createTestClient();
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let tenantSlug: string;
let tenantHost: string;
let tenantId: string;
const createdUserIds: string[] = [];

function toCookieHeader(headers: Headers): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") || ""];

  return setCookies
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function createAuthenticatedUser(opts: {
  name: string;
  isSuperAdmin?: boolean;
  status?: "active" | "suspended";
}): Promise<{ userId: string; cookie: string }> {
  const email = `access-${randomUUID().slice(0, 8)}@example.com`;
  const password = "StrongPassword123!";

  const signUp = await auth.api.signUpEmail({
    body: { email, password, name: opts.name },
  });
  createdUserIds.push(signUp.user.id);

  const verif = getLastSentEmail(email);
  if (verif?.token) {
    await auth.api.verifyEmail({ query: { token: verif.token } });
  }

  if (opts.isSuperAdmin || opts.status) {
    await systemPrisma.user.update({
      where: { id: signUp.user.id },
      data: {
        ...(opts.isSuperAdmin !== undefined
          ? { isSuperAdmin: opts.isSuperAdmin }
          : {}),
        ...(opts.status !== undefined ? { status: opts.status } : {}),
      },
    });
  }

  const signIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });

  return {
    userId: signUp.user.id,
    cookie: toCookieHeader(signIn.headers),
  };
}

beforeAll(async () => {
  http = await createHttpTestApp(TestAppModule);

  tenantSlug = `access-tenant-${randomUUID().slice(0, 8)}`;
  tenantHost = `${tenantSlug}.localhost`;
  const tenant = await db.tenant.create({
    data: {
      slug: tenantSlug,
      name: "Access Guard Test Tenant",
    },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  await http?.close();

  if (createdUserIds.length > 0) {
    await systemPrisma.membership.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await systemPrisma.session.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await systemPrisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
    });
  }

  if (tenantId) {
    await db.tenant.deleteMany({ where: { id: tenantId } });
  }

  await db.$disconnect();
  await systemPrisma.$disconnect();
});

describe("AccessGuard Reason Codes over HTTP (FR-T03)", () => {
  it("rejects suspended users with 403 USER_SUSPENDED", async () => {
    const user = await createAuthenticatedUser({
      name: "Suspended User",
      status: "suspended",
    });

    await systemPrisma.membership.create({
      data: {
        userId: user.userId,
        tenantId,
        role: "student",
        status: "active",
      },
    });

    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/member",
      undefined,
      { cookie: user.cookie },
    );

    expect(res.status).toBe(403);
    const body = res.body as { statusCode: number; reason: string };
    expect(body.statusCode).toBe(403);
    expect(body.reason).toBe(AccessReasonCode.USER_SUSPENDED);
  });

  it("rejects users with NO membership in the tenant with 403 NO_ACCESS", async () => {
    // User exists and has active status, but has no membership record in tenantId
    const outsider = await createAuthenticatedUser({
      name: "Outsider User",
      status: "active",
    });

    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/member",
      undefined,
      { cookie: outsider.cookie },
    );

    expect(res.status).toBe(403);
    const body = res.body as { statusCode: number; reason: string };
    expect(body.statusCode).toBe(403);
    expect(body.reason).toBe(AccessReasonCode.NO_ACCESS);
  });

  it("rejects users whose tenant membership is suspended with 403 NO_ACCESS", async () => {
    const member = await createAuthenticatedUser({
      name: "Suspended Member",
      status: "active",
    });

    await systemPrisma.membership.create({
      data: {
        userId: member.userId,
        tenantId,
        role: "student",
        status: "suspended",
      },
    });

    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/member",
      undefined,
      { cookie: member.cookie },
    );

    expect(res.status).toBe(403);
    const body = res.body as { statusCode: number; reason: string };
    expect(body.statusCode).toBe(403);
    expect(body.reason).toBe(AccessReasonCode.NO_ACCESS);
  });

  it("rejects non-superadmins accessing superadmin endpoint with 403 NO_ACCESS", async () => {
    const regularUser = await createAuthenticatedUser({
      name: "Regular User",
      isSuperAdmin: false,
    });

    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/admin-only",
      undefined,
      { cookie: regularUser.cookie },
    );

    expect(res.status).toBe(403);
    const body = res.body as { statusCode: number; reason: string };
    expect(body.statusCode).toBe(403);
    expect(body.reason).toBe(AccessReasonCode.NO_ACCESS);
  });

  it("rejects users when tenant has paused their role with 403 TENANT_PAUSED", async () => {
    const student = await createAuthenticatedUser({
      name: "Paused Student",
      status: "active",
    });

    await systemPrisma.membership.create({
      data: {
        userId: student.userId,
        tenantId,
        role: "student",
        status: "active",
      },
    });

    // Pause the 'student' role on the tenant
    await systemPrisma.tenant.update({
      where: { id: tenantId },
      data: { pausedRoles: ["student"] },
    });

    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/member",
      undefined,
      { cookie: student.cookie },
    );

    expect(res.status).toBe(403);
    const body = res.body as { statusCode: number; reason: string };
    expect(body.statusCode).toBe(403);
    expect(body.reason).toBe(AccessReasonCode.TENANT_PAUSED);

    // Unpause role for remaining tests
    await systemPrisma.tenant.update({
      where: { id: tenantId },
      data: { pausedRoles: [] },
    });
  });

  it("rejects role mismatch with 403 ROLE_FORBIDDEN", async () => {
    const student = await createAuthenticatedUser({
      name: "Role Mismatch Student",
      status: "active",
    });

    await systemPrisma.membership.create({
      data: {
        userId: student.userId,
        tenantId,
        role: "student",
        status: "active",
      },
    });

    // Student calling teacher-only endpoint
    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/teacher-only",
      undefined,
      { cookie: student.cookie },
    );

    expect(res.status).toBe(403);
    const body = res.body as { statusCode: number; reason: string };
    expect(body.statusCode).toBe(403);
    expect(body.reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);
  });

  it("grants access to active teacher on teacher-only endpoint", async () => {
    const teacher = await createAuthenticatedUser({
      name: "Authorized Teacher",
      status: "active",
    });

    await systemPrisma.membership.create({
      data: {
        userId: teacher.userId,
        tenantId,
        role: "teacher",
        status: "active",
      },
    });

    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/teacher-only",
      undefined,
      { cookie: teacher.cookie },
    );

    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; role: string };
    expect(body.ok).toBe(true);
    expect(body.role).toBe("teacher");
  });

  it("grants access to super admin on superadmin-only endpoint", async () => {
    const superAdmin = await createAuthenticatedUser({
      name: "Super Administrator",
      isSuperAdmin: true,
      status: "active",
    });

    const res = await http.send(
      tenantHost,
      "GET",
      "/api/access-test/admin-only",
      undefined,
      { cookie: superAdmin.cookie },
    );

    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; isSuperAdmin: boolean };
    expect(body.ok).toBe(true);
    expect(body.isSuperAdmin).toBe(true);
  });
});
