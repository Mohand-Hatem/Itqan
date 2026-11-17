import type { INestApplication, Type } from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { getOptionsToken, ThrottlerGuard } from "@nestjs/throttler";
import type { Role } from "@itqan/database";
import { z } from "zod";
import { IS_PUBLIC_KEY } from "../auth/public.decorator.js";
import {
  ALLOW_WHILE_PASSWORD_CHANGE_KEY,
  ROLES_KEY,
  SUPER_ADMIN_ONLY_KEY,
} from "../auth/roles.decorator.js";
import { API_TAGS, authOperations, operations, type OperationDoc } from "./operations.js";

type Operation = NonNullable<OpenAPIObject["paths"][string]["post"]>;
type Method = "get" | "post" | "put" | "patch" | "delete";
const METHODS: Method[] = ["get", "post", "put", "patch", "delete"];
const WRITE: Method[] = ["post", "put", "patch"];

/** Zod schema → OpenAPI 3.0 schema object (request shape: the input side of transforms). */
export function toOpenApiSchema(schema: z.ZodType, io: "input" | "output" = "input") {
  const json = z.toJSONSchema(schema, { io, unrepresentable: "any", target: "openapi-3.0" });
  delete (json as Record<string, unknown>)["$schema"];
  return json as Record<string, unknown>;
}

/** What the guards enforce on one route, read from the decorators (10R.8). */
export interface GuardInfo {
  isPublic: boolean;
  superAdminOnly: boolean;
  roles: Role[];
  allowWhilePasswordChange: boolean;
  /** Human rate-limit lines, when the route uses ThrottlerGuard. */
  rateLimits: string[];
}

const per = (ms: number) =>
  ms % 3_600_000 === 0
    ? ms === 3_600_000
      ? "hour"
      : `${ms / 3_600_000} hours`
    : ms % 60_000 === 0
      ? ms === 60_000
        ? "minute"
        : `${ms / 60_000} minutes`
      : `${ms / 1000} s`;
const TRACKED_BY: Record<string, string> = { email: "email", ip: "IP", code: "access code" };

/** Guard metadata of every controller route, keyed `Controller_method` like Nest's operation ids. */
export function guardMetadata(app: INestApplication): Map<string, GuardInfo> {
  const reflector = new Reflector();
  const throttlerOptions = app.get<unknown>(getOptionsToken(), { strict: false });
  // A sorted copy: stable lines whatever the module load order, and the options stay untouched.
  const throttlers = [
    ...((Array.isArray(throttlerOptions)
      ? throttlerOptions
      : ((throttlerOptions as { throttlers?: unknown[] })?.throttlers ?? [])) as {
      name?: string;
      limit: number;
      ttl: number;
    }[]),
  ].sort((x, y) => (x.name ?? "").localeCompare(y.name ?? ""));

  const out = new Map<string, GuardInfo>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const cls = wrapper.metatype as Type | null;
      if (!cls) continue;
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const handler = (cls.prototype as Record<string, unknown>)[name];
        if (name === "constructor" || typeof handler !== "function") continue;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const targets = [handler, cls];
        const get = <T>(key: string) => reflector.getAllAndOverride<T>(key, targets);
        const guards = [
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
          ...((Reflect.getMetadata(GUARDS_METADATA, cls) as unknown[]) ?? []),
        ];
        const rateLimits = guards.includes(ThrottlerGuard)
          ? throttlers.flatMap((t) => {
              const n = t.name ?? "default";
              if (get<boolean>(`THROTTLER:SKIP${n}`)) return [];
              const limit = get<number>(`THROTTLER:LIMIT${n}`) ?? t.limit;
              const ttl = get<number>(`THROTTLER:TTL${n}`) ?? t.ttl;
              return [`${limit} per ${per(ttl)} per ${TRACKED_BY[n] ?? n}`];
            })
          : [];
        out.set(`${cls.name}_${name}`, {
          isPublic: Boolean(get<boolean>(IS_PUBLIC_KEY)),
          superAdminOnly: Boolean(get<boolean>(SUPER_ADMIN_ONLY_KEY)),
          roles: get<Role[]>(ROLES_KEY) ?? [],
          allowWhilePasswordChange: Boolean(get<boolean>(ALLOW_WHILE_PASSWORD_CHANGE_KEY)),
          rateLimits,
        });
      }
    }
  }
  return out;
}

/** `Controller_method[1]` → `Controller_method` (extra paths of one handler). */
export const handlerKey = (nestId: string) => nestId.replace(/\[\d+\]$/, "");

const ROLE_NAMES: Record<Role, string> = { teacher: "teacher", assistant: "assistant", student: "student" };

/** The generated "Who / Authentication / Tenant scope / Rate limit" lines (10R.8). */
export function accessLines(path: string, g: GuardInfo, sessionInHandler = false): string[] {
  const adminHost = path.startsWith("/api/admin/");
  const who = sessionInHandler
    ? "any signed-in user; no membership in this academy needed yet"
    : g.isPublic
    ? "anyone, no session needed"
    : g.superAdminOnly || adminHost
      ? "super admin only"
      : g.roles.length
        ? `${g.roles.map((r) => ROLE_NAMES[r]).join(", ")} of this academy, and the super admin`
        : "any signed-in member of this academy, and the super admin";
  const auth = g.isPublic && !sessionInHandler
    ? "none"
    : "session cookie from `/api/auth/sign-in/email` (staff) or `/api/auth/sign-in/student`; " +
      "students also send their device cookie";
  const scope =
    path === "/api/health"
      ? "any host"
      : adminHost
        ? "admin host (`admin.<root>`); the academy, if any, is the `{tenantId}` path parameter"
        : "academy host (`<slug>.<root>`); the academy comes from the Host header";
  const lines = [`**Who:** ${who}.`, `**Authentication:** ${auth}.`, `**Tenant scope:** ${scope}.`];
  if (g.rateLimits.length) lines.push(`**Rate limit:** ${g.rateLimits.join("; ")}.`);
  if (!g.isPublic && g.allowWhilePasswordChange) {
    lines.push("**Password change:** answers even while the user must change their password.");
  }
  return lines;
}

/** Status → reason codes, including what the guards add on their own. */
export function errorReasons(doc: OperationDoc, g: GuardInfo, path: string) {
  const errors: Record<number, string[]> = {};
  const add = (status: number, ...reasons: string[]) => {
    errors[status] = [...new Set([...(errors[status] ?? []), ...reasons])];
  };
  if (!g.isPublic) {
    add(403, "USER_SUSPENDED");
    if (!g.allowWhilePasswordChange) add(403, "PASSWORD_CHANGE_REQUIRED");
    if (g.superAdminOnly || path.startsWith("/api/admin/")) add(403, "NO_ACCESS");
    else {
      add(403, "NO_ACCESS", "TENANT_PAUSED");
      if (g.roles.length) add(403, "ROLE_FORBIDDEN");
      if (g.roles.length === 0 || g.roles.includes("student")) add(403, "DEVICE_NOT_REGISTERED");
    }
  }
  if (doc.body) add(400, "INVALID_BODY");
  for (const [status, reasons] of Object.entries(doc.errors ?? {})) add(Number(status), ...(reasons ?? []));
  return errors;
}

/** Every operation of the Nest document as [nestId, path, method, op]. */
export function nestOperations(doc: OpenAPIObject) {
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => [item[m]!.operationId!, path, m, item[m]!] as const),
  );
}

/**
 * The full API description (10R.8): NestJS routes documented from the central map
 * (operations.ts), access lines generated from the guards, and Better Auth's /api/auth routes.
 * Throws when a route has no map entry or an entry has no route, so the docs cannot drift.
 */
export function buildOpenApiDocument(app: INestApplication, authSpec?: OpenAPIObject): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Itqan API")
    .setDescription(
      "Multi-tenant LMS API. The academy comes from the Host header: open these docs on " +
        "`http://<slug>.localhost:8080/api/docs` for academy routes and `http://admin.localhost:8080/api/docs` " +
        "for platform routes, so Try it out stays on the same origin (see README, dev gateway). Sign in first " +
        "through `/api/auth/sign-in/email` (staff) or `/api/auth/sign-in/student`; the cookies then carry over.\n\n" +
        'Errors: `{ "statusCode", "reason", "message" }`; Better Auth routes answer `{ "code" }`.',
    )
    .setVersion("0.2.0")
    .addServer("/", "This host (same origin)")
    .addCookieAuth("better-auth.session_token")
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  const guards = guardMetadata(app);

  const used = new Set<string>();
  for (const [nestId, path, method, op] of nestOperations(doc)) {
    const entry = operations[nestId];
    if (!entry) throw new Error(`openapi/operations.ts has no entry for ${nestId} (${method} ${path})`);
    const g = guards.get(handlerKey(nestId));
    if (!g) throw new Error(`No guard metadata for ${nestId}`);
    used.add(nestId);
    applyEntry(op as Operation, entry, g, path, method);
  }
  const unused = Object.keys(operations).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`openapi/operations.ts names routes that do not exist: ${unused.join(", ")}`);

  if (authSpec) {
    for (const [path, item] of Object.entries(authSpec.paths ?? {})) {
      const overlay = authOperations[path];
      if (!overlay) continue; // callback/{id}, error: hidden
      for (const op of Object.values(item) as Operation[]) {
        if (!op || typeof op !== "object" || !("responses" in op)) continue;
        op.tags = ["Authentication & Accounts"];
        op.summary = overlay.summary;
        op.description = `${overlay.description}\n\n**Who:** ${overlay.who}\n\n**Served by:** Next.js (Better Auth).`;
      }
      doc.paths[`/api/auth${path}`] = item;
    }
    doc.components = {
      ...doc.components,
      schemas: { ...(authSpec.components?.schemas ?? {}), ...(doc.components?.schemas ?? {}) },
    };
  }

  doc.tags = API_TAGS.map((t) => ({ name: t.name, description: t.description }));
  return doc;
}

function applyEntry(op: Operation, entry: OperationDoc, g: GuardInfo, path: string, method: Method) {
  op.operationId = entry.id;
  op.tags = [entry.tag];
  op.summary = entry.summary;

  const errors = errorReasons(entry, g, path);
  op.description = [
    entry.description ?? null,
    entry.rules?.length ? `**Rules:**\n${entry.rules.map((r) => `- ${r}`).join("\n")}` : null,
    accessLines(path, g, entry.sessionInHandler).join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  op.security = g.isPublic && !entry.sessionInHandler ? [] : [{ cookie: [] }];

  if (WRITE.includes(method) && entry.body) {
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: toOpenApiSchema(entry.body) as never,
          ...(entry.example !== undefined ? { example: entry.example } : {}),
        },
      },
    };
  }

  if (entry.query) {
    const json = toOpenApiSchema(entry.query);
    const props = (json["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set((json["required"] as string[] | undefined) ?? []);
    const fromPath = (op.parameters ?? []).filter((p) => "in" in p && p.in === "path");
    op.parameters = [
      ...fromPath,
      ...Object.entries(props).map(([name, schema]) => ({
        name,
        in: "query" as const,
        required: required.has(name),
        schema: schema as never,
      })),
    ];
  }

  const successCode = Object.keys(op.responses).find((c) => c.startsWith("2")) ?? "200";
  op.responses = {
    [successCode]: {
      description: "Success",
      ...(entry.response
        ? { content: { "application/json": { schema: toOpenApiSchema(entry.response, "output") as never } } }
        : {}),
    },
  };
  // 401 (no session) and 429 (rate limit) bodies carry a message but no reason code.
  const generic: Record<string, string> = {
    ...(g.isPublic ? {} : { "401": "Not signed in." }),
    ...(g.rateLimits.length ? { "429": "Rate limit reached." } : {}),
  };
  for (const status of [...new Set([...Object.keys(errors), ...Object.keys(generic)])].sort()) {
    const reasons = (errors[Number(status)] ?? []).map((r) => `\`${r}\``).join(", ");
    op.responses[status] = { description: [generic[status], reasons].filter(Boolean).join(" ") };
  }
}

/** Write routes (POST, PUT, PATCH) of the NestJS API, as "METHOD /path" keys. */
export function writeRoutes(doc: OpenAPIObject): string[] {
  return Object.entries(doc.paths)
    .filter(([path]) => !path.startsWith("/api/auth/"))
    .flatMap(([path, item]) => WRITE.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${path}`))
    .sort();
}
