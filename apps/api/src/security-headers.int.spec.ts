// Step 10.2a: security headers on every API response (docs/09 §2), and no CORS: pages and
// /api share one host, so no other origin may read API responses.
import { type IncomingHttpHeaders, request } from "node:http";
import type { AddressInfo } from "node:net";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";
import { createHttpTestApp } from "./testing/http.js";
import { studentFixtures } from "./testing/students.js";

const fx = studentFixtures("HeadersTestPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let tenantHost: string;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
  const t = await fx.tenant();
  tenantHost = `${t.slug}.localhost`;
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

function raw(
  method: string,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  const port = (http.app.getHttpServer().address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const req = request({ port, path, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

function expectSecurityHeaders(h: IncomingHttpHeaders) {
  expect(h["content-security-policy"]).toContain("default-src 'none'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-powered-by"]).toBeUndefined();
}

describe("security headers (step 10.2a, docs/09 §2)", () => {
  it("are set on a successful response", async () => {
    const res = await raw("GET", "/api/health", { host: tenantHost });
    expect(res.status).toBe(200);
    expectSecurityHeaders(res.headers);
  });

  it("are set on error responses too (401 and unknown tenant 404)", async () => {
    const unauthorized = await raw("GET", "/api/me", { host: tenantHost });
    expect(unauthorized.status).toBe(401);
    expectSecurityHeaders(unauthorized.headers);

    const unknown = await raw("GET", "/api/me", { host: "no-such-tenant.localhost" });
    expect(unknown.status).toBe(404);
    expectSecurityHeaders(unknown.headers);
  });

  it("gives no CORS access to another origin, on requests or preflights", async () => {
    const evil = { host: tenantHost, origin: "https://evil.example" };
    const get = await raw("GET", "/api/health", evil);
    expect(get.headers["access-control-allow-origin"]).toBeUndefined();

    const preflight = await raw("OPTIONS", "/api/me", {
      ...evil,
      "access-control-request-method": "GET",
    });
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
    expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
