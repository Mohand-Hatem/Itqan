import { randomUUID } from "node:crypto";
import { Controller, Get, Module, Req } from "@nestjs/common";
import { auth, getLastSentEmail } from "@itqan/auth";
import { createTestClient, systemPrisma } from "@itqan/database";
import type { Request } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthController } from "../health/health.controller.js";
import { createHttpTestApp } from "../testing/http.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AuthModule } from "./auth.module.js";
import { Public } from "./public.decorator.js";

// Test-only controller to verify protected and public endpoint behaviors.
class AuthTestController {
  getProtected(req: Request) {
    return { ok: true, user: req.user, session: req.session };
  }

  getPublic(req: Request) {
    return { ok: true, public: true, user: req.user ?? null };
  }
}

// Imperative decorator registration so spec files outside tsconfig always compile reliably
const protDesc = Object.getOwnPropertyDescriptor(AuthTestController.prototype, "getProtected")!;
Req()(AuthTestController.prototype, "getProtected", 0);
Get("protected")(AuthTestController.prototype, "getProtected", protDesc);

const pubDesc = Object.getOwnPropertyDescriptor(AuthTestController.prototype, "getPublic")!;
Req()(AuthTestController.prototype, "getPublic", 0);
Public()(AuthTestController.prototype, "getPublic", pubDesc);
Get("public")(AuthTestController.prototype, "getPublic", pubDesc);

Controller("auth-test")(AuthTestController);

class TestAppModule {}
Module({
  imports: [TenancyModule, AuthModule],
  controllers: [HealthController, AuthTestController],
})(TestAppModule);

const db = createTestClient();
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let tenantSlug: string;
let tenantHost: string;
const createdUserIds: string[] = [];
let validSessionCookie: string;

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

beforeAll(async () => {
  // 1. Start HTTP test app
  http = await createHttpTestApp(TestAppModule);

  // 2. Create test tenant
  tenantSlug = `tenant-${randomUUID().slice(0, 8)}`;
  tenantHost = `${tenantSlug}.localhost`;
  const tenant = await db.tenant.create({
    data: {
      slug: tenantSlug,
      name: "Session Guard Test Tenant",
    },
  });

  // 3. Create test user and obtain valid session
  const email = `session-user-${randomUUID().slice(0, 8)}@example.com`;
  const password = "StrongPassword123!";

  const signUp = await auth.api.signUpEmail({
    body: { email, password, name: "Session User" },
  });
  createdUserIds.push(signUp.user.id);

  // Assign active student membership in this tenant
  await systemPrisma.membership.create({
    data: {
      userId: signUp.user.id,
      tenantId: tenant.id,
      role: "student",
      status: "active",
    },
  });

  const verif = getLastSentEmail(email);
  if (verif?.token) {
    await auth.api.verifyEmail({ query: { token: verif.token } });
  }

  // Students sign in through the device-checked endpoint (ADR-011).
  const signIn = await auth.api.signInStudent({
    body: { email, password },
    headers: new Headers({ host: tenantHost }),
    returnHeaders: true,
  });

  validSessionCookie = toCookieHeader(signIn.headers);
  expect(validSessionCookie).toContain("better-auth.session_token");
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

  if (tenantSlug) {
    await db.tenant.deleteMany({ where: { slug: tenantSlug } });
  }

  await db.$disconnect();
  await systemPrisma.$disconnect();
});

describe("NestJS SessionGuard (integration)", () => {
  it("allows unauthenticated requests to public health endpoint", async () => {
    // Health is public and excluded from tenant middleware
    const res = await http.send("localhost", "GET", "/api/health");

    expect(res.status).toBe(200);
    const body = res.body as { status: string };
    expect(body.status).toBe("ok");
  });

  it("allows unauthenticated requests to custom public endpoint", async () => {
    const res = await http.send(tenantHost, "GET", "/api/auth-test/public");

    expect(res.status).toBe(200);
    const body = res.body as { ok: boolean; public: boolean; user: unknown };
    expect(body.ok).toBe(true);
    expect(body.public).toBe(true);
    expect(body.user).toBeNull();
  });

  it("rejects unauthenticated requests to protected endpoint with 401 Unauthorized", async () => {
    const res = await http.send(tenantHost, "GET", "/api/auth-test/protected");

    expect(res.status).toBe(401);
    const body = res.body as { statusCode: number; message: string };
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe("Unauthorized");
  });

  it("rejects requests with invalid session cookie with 401 Unauthorized", async () => {
    const res = await http.send(tenantHost, "GET", "/api/auth-test/protected", undefined, {
      cookie: "better-auth.session_token=completely-invalid-token",
    });

    expect(res.status).toBe(401);
    const body = res.body as { statusCode: number; message: string };
    expect(body.statusCode).toBe(401);
    expect(body.message).toBe("Unauthorized");
  });

  it("allows requests with valid session cookie and injects user and session", async () => {
    const res = await http.send(tenantHost, "GET", "/api/auth-test/protected", undefined, {
      cookie: validSessionCookie,
    });

    expect(res.status).toBe(200);
    const body = res.body as {
      ok: boolean;
      user: { id: string; email: string };
      session: { id: string; token: string };
    };
    expect(body.ok).toBe(true);
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe(createdUserIds[0]);
    expect(body.session).toBeDefined();
  });

  it("populates user on public endpoint when valid session is supplied", async () => {
    const res = await http.send(tenantHost, "GET", "/api/auth-test/public", undefined, {
      cookie: validSessionCookie,
    });

    expect(res.status).toBe(200);
    const body = res.body as {
      ok: boolean;
      public: boolean;
      user: { id: string };
    };
    expect(body.ok).toBe(true);
    expect(body.public).toBe(true);
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe(createdUserIds[0]);
  });
});
