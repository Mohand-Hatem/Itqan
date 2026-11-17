// 10R.8: the OpenAPI document is built from the central map (operations.ts) and stays in step with
// the code: every route mapped once, valid examples, real reason codes, access lines that match
// what the guards do (role sweep), and an export that is current.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { auth, DISABLED_AUTH_PATHS } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";
import { buildOpenApiDocument, errorReasons, guardMetadata, handlerKey, nestOperations } from "./document.js";
import { API_TAGS, operations } from "./operations.js";

const ROOT = resolve(__dirname, "../../../..");
const fx = studentFixtures("OpenApiSweepPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let doc: OpenAPIObject;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
  const api = auth.api as unknown as { generateOpenAPISchema: () => Promise<unknown> };
  doc = buildOpenApiDocument(http.app, (await api.generateOpenAPISchema()) as never);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

const raw = () => nestOperations(SwaggerModule.createDocument(http.app, new DocumentBuilder().build()));
const WRITE = new Set(["post", "put", "patch"]);

describe("central documentation map (10R.8)", () => {
  it("has exactly one entry per NestJS operation", () => {
    expect(Object.keys(operations).sort()).toEqual(raw().map(([id]) => id).sort());
  });

  it("gives every operation a unique public id, one approved tag, a summary and access lines", () => {
    const tags = new Set<string>(API_TAGS.map((t) => t.name));
    const ids = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const op of Object.values(item) as { operationId?: string; tags?: string[]; summary?: string; description?: string }[]) {
        if (!op || typeof op !== "object" || !("responses" in op)) continue;
        expect(op.tags?.length, path).toBe(1);
        expect(tags.has(op.tags![0]!), `${path}: ${op.tags![0]}`).toBe(true);
        expect(op.summary, path).toBeTruthy();
        if (path.startsWith("/api/auth/")) continue;
        expect(ids.has(op.operationId!), `duplicate ${op.operationId}`).toBe(false);
        ids.add(op.operationId!);
        expect(op.operationId).toMatch(/^[a-z][A-Za-z]+$/);
        expect(op.description, path).toContain("**Who:**");
        expect(op.description, path).toContain("**Tenant scope:**");
      }
    }
    expect(doc.tags?.map((t) => t.name)).toEqual(API_TAGS.map((t) => t.name));
  });

  it("states a request body (or null) for every write route and none for reads", () => {
    for (const [id, , method] of raw()) {
      const body = operations[id]!.body;
      if (WRITE.has(method)) expect(body, id).not.toBeUndefined();
      else expect(body, id).toBeUndefined();
    }
  });

  it("has examples that pass their request schemas", () => {
    for (const [id, entry] of Object.entries(operations)) {
      if (entry.example === undefined) continue;
      expect(entry.body, id).toBeTruthy();
      const parsed = entry.body!.safeParse(entry.example);
      expect(parsed.success, `${id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("documents only reason codes that exist in the code", () => {
    const sources = ["apps/api/src", "packages/shared/src", "packages/auth/src"].flatMap((dir) =>
      (readdirSync(join(ROOT, dir), { recursive: true }) as string[])
        .filter((f) => f.endsWith(".ts") && !f.includes(".spec.") && !f.includes("generated") && !/openapi[\\/]/.test(f))
        .map((f) => readFileSync(join(ROOT, dir, f), "utf8")),
    );
    const known = new Set(sources.flatMap((s) => [...s.matchAll(/["'`]([A-Z][A-Z0-9_]{2,})["'`]/g)].map((m) => m[1]!)));
    const guards = guardMetadata(http.app);
    const missing = raw().flatMap(([id, path]) =>
      Object.values(errorReasons(operations[id]!, guards.get(handlerKey(id))!, path))
        .flat()
        .filter((r) => !known.has(r))
        .map((r) => `${id}: ${r}`),
    );
    expect(missing).toEqual([]);
  });

  it("documents Better Auth routes and hides callback, error and switched-off paths", () => {
    expect(doc.paths["/api/auth/sign-in/email"]).toBeDefined();
    expect(doc.paths["/api/auth/sign-in/student"]).toBeDefined();
    expect(doc.paths["/api/auth/callback/{id}"]).toBeUndefined();
    expect(doc.paths["/api/auth/error"]).toBeUndefined();
    for (const path of DISABLED_AUTH_PATHS) expect(doc.paths[`/api/auth${path}`], path).toBeUndefined();
    expect(Object.keys(doc.paths).filter((p) => /two-factor|mfa/.test(p))).toEqual([]);
  });

  it("docs/api/openapi.json is up to date (run `npm run openapi:export` if this fails)", () => {
    const file = JSON.parse(readFileSync(join(ROOT, "docs/api/openapi.json"), "utf8")) as OpenAPIObject;
    expect(file).toEqual(JSON.parse(JSON.stringify(doc)));
  });
});

/**
 * Role sweep: the "Who" lines come from guard metadata; this proves the guards do what the
 * metadata says, for every operation. Path parameters are random ids: the guards answer first.
 */
describe("role sweep against the real guards (10R.8)", () => {
  it("refuses callers outside each operation's audience", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");
    const assistant = await fx.staffLogin(t, "assistant");
    const student = await fx.member(t.id, "student");
    const studentLogin = await fx.studentLogin(t, student.user.email);
    expect(studentLogin.status).toBe(200);
    const cookies = { teacher: teacher.cookie, assistant: assistant.cookie, student: studentLogin.cookies };

    const guards = guardMetadata(http.app);
    const failures: string[] = [];
    for (const [id, path, method] of raw()) {
      const g = guards.get(handlerKey(id))!;
      const url = path.replace(/\{[^}]+\}/g, () => randomUUID());
      const admin = path.startsWith("/api/admin/");
      const host = admin ? "admin.localhost" : `${t.slug}.localhost`;
      const body = WRITE.has(method) ? {} : undefined;
      const call = (cookie?: string) =>
        http.send(host, method.toUpperCase(), url, body, cookie ? { cookie } : {});
      const reason = (b: unknown) => (b as { reason?: string })?.reason;

      if (g.isPublic) {
        const res = await call();
        const expected401 = Boolean(operations[id]!.sessionInHandler);
        if ((res.status === 401) !== expected401) {
          failures.push(`${id}: anonymous call gave ${res.status} (documented: ${expected401 ? "401" : "open"})`);
        }
        continue;
      }
      const anon = await call();
      if (anon.status !== 401) failures.push(`${id}: no session gave ${anon.status}`);

      if (g.superAdminOnly || admin) {
        const res = await http.send("admin.localhost", method.toUpperCase(), url, body, { cookie: teacher.cookie });
        if (res.status !== 403) failures.push(`${id}: teacher on admin route gave ${res.status}`);
        continue;
      }
      for (const role of ["teacher", "assistant", "student"] as const) {
        if (!g.roles.length || g.roles.includes(role)) continue;
        const res = await call(cookies[role]);
        if (res.status !== 403 || reason(res.body) !== AccessReasonCode.ROLE_FORBIDDEN) {
          failures.push(`${id}: ${role} gave ${res.status} ${reason(res.body) ?? ""}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});
