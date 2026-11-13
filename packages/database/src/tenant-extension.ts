import { getRequestContext, type RequestContext } from "./context.js";
import type { PrismaClient } from "./generated/prisma/client.js";

// Every model with a tenantId column, except the global ones listed in
// tenant-extension.spec.ts (Session). That spec fails if one is missing.
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  "Membership",
  "AuditLog",
  "SupportRequest",
  "Course",
  "Invitation",
  "Enrollment",
  "AccessCodeBatch",
  "AccessCode",
  "MediaAsset",
  "ContentItem",
  "LessonProgress",
]);

export class TenantScopeError extends Error {
  constructor(
    readonly code: "NO_TENANT_CONTEXT" | "TENANT_MISMATCH" | "UNSUPPORTED_OPERATION",
    message: string,
  ) {
    super(message);
    this.name = "TenantScopeError";
  }
}

type Args = Record<string, unknown>;
type Data = Record<string, unknown>;

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
const UPDATE_DATA_OPS = new Set(["update", "updateMany", "updateManyAndReturn"]);

function scopeWhere(where: unknown, tenantId: string, model: string): Data {
  const w = (where ?? {}) as Data;
  if (w["tenantId"] !== undefined && w["tenantId"] !== tenantId) {
    throw new TenantScopeError("TENANT_MISMATCH", `${model}: query asked for another tenant.`);
  }
  return { ...w, tenantId };
}

function scopeCreateData(data: Data, tenantId: string, model: string): Data {
  if (data["tenant"] !== undefined) {
    throw new TenantScopeError(
      "TENANT_MISMATCH",
      `${model}: set the tenant through the request context.`,
    );
  }
  if (data["tenantId"] !== undefined && data["tenantId"] !== tenantId) {
    throw new TenantScopeError("TENANT_MISMATCH", `${model}: row belongs to another tenant.`);
  }
  return { ...data, tenantId };
}

function checkUpdateData(data: unknown, tenantId: string, model: string): void {
  const d = (data ?? {}) as Data;
  if (d["tenant"] !== undefined || (d["tenantId"] !== undefined && d["tenantId"] !== tenantId)) {
    throw new TenantScopeError("TENANT_MISMATCH", `${model}: rows cannot move to another tenant.`);
  }
}

// Pure rewrite of one query's arguments. Exported for unit tests.
export function scopeArgs(
  model: string,
  operation: string,
  args: Args,
  context: RequestContext | undefined,
): Args {
  if (!TENANT_MODELS.has(model)) return args;
  if (context?.kind === "admin") return args; // Platform code names the tenant explicitly.
  if (!context) {
    throw new TenantScopeError(
      "NO_TENANT_CONTEXT",
      `${model}.${operation} ran outside a tenant request. Use systemPrisma for system code.`,
    );
  }

  const { tenantId } = context;
  const out: Args = { ...args };

  if (WHERE_OPS.has(operation)) {
    out["where"] = scopeWhere(args["where"], tenantId, model);
    if (UPDATE_DATA_OPS.has(operation)) checkUpdateData(args["data"], tenantId, model);
    return out;
  }
  if (CREATE_OPS.has(operation)) {
    const data = args["data"];
    out["data"] = Array.isArray(data)
      ? data.map((row: Data) => scopeCreateData(row, tenantId, model))
      : scopeCreateData((data ?? {}) as Data, tenantId, model);
    return out;
  }
  if (operation === "upsert") {
    out["where"] = scopeWhere(args["where"], tenantId, model);
    out["create"] = scopeCreateData((args["create"] ?? {}) as Data, tenantId, model);
    checkUpdateData(args["update"], tenantId, model);
    return out;
  }
  // Fail closed: an operation we don't know how to scope must not run unscoped.
  throw new TenantScopeError(
    "UNSUPPORTED_OPERATION",
    `${model}.${operation} is not tenant-scoped.`,
  );
}

// Limits: raw SQL ($queryRaw) is not covered (filter tenant_id by hand), and nested
// relation reads rely on their parent row being scoped. Postgres RLS is the planned second lock.
export function withTenantScope(client: PrismaClient) {
  return client.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, getRequestContext()));
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof withTenantScope>;
