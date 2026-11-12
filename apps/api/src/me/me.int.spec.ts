import { randomUUID } from "node:crypto";
import { auth, getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, type MeResponse } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";

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
}): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `me-test-${randomUUID().slice(0, 8)}@example.com`;
  const password = "StrongPassword123!";

  const signUp = await auth.api.signUpEmail({
    body: { email, password, name: opts.name },
  });
  createdUserIds.push(signUp.user.id);

  const verificationEmail = getLastSentEmail(email);
  if (verificationEmail) {
    const url = new URL(verificationEmail.url);
    const token = url.searchParams.get("token");
    if (token) {
      await auth.api.verifyEmail({ query: { token } });
    }
  }

  if (opts.isSuperAdmin || opts.status) {
    await systemPrisma.user.update({
      where: { id: signUp.user.id },
      data: {
        isSuperAdmin: opts.isSuperAdmin ?? false,
        status: opts.status ?? "active",
      },
    });
  }

  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });

  const cookie = toCookieHeader(signIn.headers);
  return { userId: signUp.user.id, email, cookie };
}

describe("GET /api/me (FR-T03, Step 4.9a)", () => {
  beforeAll(async () => {
    http = await createHttpTestApp(AppModule);

    tenantSlug = `me-tenant-${randomUUID().slice(0, 8)}`;
    tenantHost = `${tenantSlug}.localhost`;

    const tenant = await systemPrisma.tenant.create({
      data: {
        name: `Me Tenant ${tenantSlug}`,
        slug: tenantSlug,
        settings: { branding: { primaryColor: "#112233" } },
      },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await http.close();

    if (createdUserIds.length > 0) {
      await systemPrisma.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.membership.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    if (tenantId) {
      await systemPrisma.membership.deleteMany({ where: { tenantId } });
      await systemPrisma.tenant.delete({ where: { id: tenantId } });
    }
  });

  it("returns 401 Unauthorized without session", async () => {
    const res = await http.send(tenantHost, "GET", "/api/me");
    expect(res.status).toBe(401);
  });

  it("returns MeResponse for active teacher on tenant host", async () => {
    const teacher = await createAuthenticatedUser({ name: "Teacher User" });

    await systemPrisma.membership.create({
      data: {
        tenantId,
        userId: teacher.userId,
        role: "teacher",
        status: "active",
        phone: "+201011112222",
      },
    });

    const res = await http.send(tenantHost, "GET", "/api/me", undefined, {
      cookie: teacher.cookie,
    });

    expect(res.status).toBe(200);
    const body = res.body as MeResponse;

    expect(body.user.id).toBe(teacher.userId);
    expect(body.user.email).toBe(teacher.email);
    expect(body.user.name).toBe("Teacher User");
    expect(body.user.status).toBe("active");

    expect(body.tenant).toBeDefined();
    expect(body.tenant?.id).toBe(tenantId);
    expect(body.tenant?.slug).toBe(tenantSlug);
    expect(body.tenant?.name).toBe(`Me Tenant ${tenantSlug}`);

    expect(body.membership).toBeDefined();
    expect(body.membership?.role).toBe("teacher");
    expect(body.membership?.status).toBe("active");
    expect(body.membership?.phone).toBe("+201011112222");

    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0]?.tenantSlug).toBe(tenantSlug);
    expect(body.memberships[0]?.role).toBe("teacher");

    expect(body.permissions.canManageSettings).toBe(true);
    expect(body.permissions.canManageCourses).toBe(true);
    expect(body.permissions.canManageAssistants).toBe(true);
    expect(body.permissions.canManagePayments).toBe(true);
    expect(body.permissions.canDeleteCourse).toBe(true);
    expect(body.permissions.canManageTenants).toBe(false);
    expect(body.permissions.canLearn).toBe(false);
  });

  it("returns MeResponse for active student with student permissions", async () => {
    const student = await createAuthenticatedUser({ name: "Student User" });

    await systemPrisma.membership.create({
      data: {
        tenantId,
        userId: student.userId,
        role: "student",
        status: "active",
      },
    });

    // Students sign in through the device-checked endpoint (ADR-011); every request then
    // needs the device cookie too (step 5.4).
    const signIn = await auth.api.signInStudent({
      body: { email: student.email, password: "StrongPassword123!" },
      headers: new Headers({ host: tenantHost }),
      returnHeaders: true,
    });

    const res = await http.send(tenantHost, "GET", "/api/me", undefined, {
      cookie: toCookieHeader(signIn.headers),
    });

    expect(res.status).toBe(200);
    const body = res.body as MeResponse;

    expect(body.user.id).toBe(student.userId);
    expect(body.membership?.role).toBe("student");
    expect(body.permissions.canLearn).toBe(true);
    expect(body.permissions.canManageCourses).toBe(false);
    expect(body.permissions.canManageSettings).toBe(false);
    expect(body.permissions.canManageTenants).toBe(false);
  });

  it("returns MeResponse for super admin on admin portal host", async () => {
    const admin = await createAuthenticatedUser({
      name: "Admin User",
      isSuperAdmin: true,
    });

    const res = await http.send("admin.localhost", "GET", "/api/me", undefined, {
      cookie: admin.cookie,
    });

    expect(res.status).toBe(200);
    const body = res.body as MeResponse;

    expect(body.user.id).toBe(admin.userId);
    expect(body.user.isSuperAdmin).toBe(true);
    expect(body.tenant).toBeNull();
    expect(body.membership).toBeNull();
    expect(body.permissions.canManageTenants).toBe(true);
    expect(body.permissions.canManageCourses).toBe(true);
    expect(body.permissions.canManageSettings).toBe(true);
  });

  it("rejects user without tenant membership with 403 NO_ACCESS", async () => {
    const outsider = await createAuthenticatedUser({ name: "Outsider User" });

    const res = await http.send(tenantHost, "GET", "/api/me", undefined, {
      cookie: outsider.cookie,
    });

    expect(res.status).toBe(403);
    expect((res.body as { reason?: string })?.reason).toBe(AccessReasonCode.NO_ACCESS);
  });

  it("rejects suspended user with 403 USER_SUSPENDED", async () => {
    const suspended = await createAuthenticatedUser({
      name: "Suspended User",
      status: "suspended",
    });

    await systemPrisma.membership.create({
      data: {
        tenantId,
        userId: suspended.userId,
        role: "student",
        status: "active",
      },
    });

    const res = await http.send(tenantHost, "GET", "/api/me", undefined, {
      cookie: suspended.cookie,
    });

    expect(res.status).toBe(403);
    expect((res.body as { reason?: string })?.reason).toBe(AccessReasonCode.USER_SUSPENDED);
  });
});
