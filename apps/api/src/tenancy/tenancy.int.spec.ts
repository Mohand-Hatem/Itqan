import { randomUUID } from "node:crypto";
import { Controller, Get, Module } from "@nestjs/common";
import { createTestClient, getRequestContext, systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { HealthController } from "../health/health.controller.js";
import { createHttpTestApp } from "../testing/http.js";
import { TenancyModule } from "./tenancy.module.js";
import { TenantResolver } from "./tenant-resolver.js";

// Test-only endpoint that echoes the request context after a small delay,
// so concurrent requests overlap. Decorators are applied as plain calls because
// spec files sit outside apps/api/tsconfig.json, so `@` syntax is not compiled here.
class ContextProbeController {
  async probe() {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return getRequestContext() ?? null;
  }
}
const probe = Object.getOwnPropertyDescriptor(ContextProbeController.prototype, "probe")!;
Get()(ContextProbeController.prototype, "probe", probe);
Controller("context-probe")(ContextProbeController);

class TestAppModule {}
Module({ imports: [TenancyModule], controllers: [HealthController, ContextProbeController] })(
  TestAppModule,
);

const db = createTestClient();
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
const tenantIds: string[] = [];
const get = (path: string, host: string) => http.send(host, "GET", path);

async function createTenant(extra: { deletedAt?: Date } = {}) {
  const slug = `t-${randomUUID().slice(0, 8)}`;
  const tenant = await db.tenant.create({ data: { slug, name: "Test", ...extra } });
  tenantIds.push(tenant.id);
  return tenant;
}

beforeAll(async () => {
  http = await createHttpTestApp(TestAppModule);
});

afterAll(async () => {
  await http.close();
  await db.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await db.$disconnect();
  await systemPrisma.$disconnect();
});

describe("tenant resolution over HTTP (integration)", () => {
  it("puts a known tenant in the request context", async () => {
    const tenant = await createTenant();
    const res = await get("/api/context-probe", `${tenant.slug}.localhost:8080`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: "tenant",
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    });
  });

  it("returns 404 TENANT_NOT_FOUND for an unknown tenant", async () => {
    const res = await get("/api/context-probe", "nobody-here.localhost");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "TENANT_NOT_FOUND" } });
  });

  it("returns 404 for a soft-deleted tenant", async () => {
    const tenant = await createTenant({ deletedAt: new Date() });
    expect((await get("/api/context-probe", `${tenant.slug}.localhost`)).status).toBe(404);
  });

  it("returns 404 for a host outside the platform", async () => {
    expect((await get("/api/context-probe", "evil.example.com")).status).toBe(404);
  });

  it("resolves admin.localhost to the super admin context", async () => {
    const res = await get("/api/context-probe", "admin.localhost");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "admin" });
  });

  it("records the visitor IP from our proxy's X-Forwarded-For, and the user agent", async () => {
    const tenant = await createTenant();
    const res = await http.send(
      `${tenant.slug}.localhost`,
      "GET",
      "/api/context-probe",
      undefined,
      {
        "x-forwarded-for": "203.0.113.7",
        "user-agent": "itqan-test",
      },
    );
    expect(res.body).toMatchObject({ ip: "203.0.113.7", userAgent: "itqan-test" });
  });

  it("serves /api/health on any host", async () => {
    expect((await get("/api/health", "anything.example.com")).status).toBe(200);
  });

  it("keeps concurrent requests for different tenants apart", async () => {
    const [a, b] = [await createTenant(), await createTenant()];
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const t = i % 2 ? a : b;
        return get("/api/context-probe", `${t.slug}.localhost`).then(
          (r) => [t.id, r.body] as const,
        );
      }),
    );
    for (const [expectedId, body] of results) {
      expect(body).toMatchObject({ tenantId: expectedId });
    }
  });
});

describe("TenantResolver cache (integration)", () => {
  it("serves a repeat lookup within 60 s from memory, then refreshes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const resolver = new TenantResolver(db);
      const tenant = await createTenant();
      expect(await resolver.findBySlug(tenant.slug)).toEqual({ id: tenant.id, slug: tenant.slug });

      // Gone from the database, but still cached.
      await db.tenant.update({ where: { id: tenant.id }, data: { deletedAt: new Date() } });
      expect(await resolver.findBySlug(tenant.slug)).toEqual({ id: tenant.id, slug: tenant.slug });

      vi.advanceTimersByTime(60_001);
      expect(await resolver.findBySlug(tenant.slug)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
