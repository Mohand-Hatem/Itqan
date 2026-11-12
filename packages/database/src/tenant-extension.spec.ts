import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "./context.js";
import { scopeArgs, TENANT_MODELS } from "./tenant-extension.js";

const A: RequestContext = { kind: "tenant", tenantId: "tenant-a", tenantSlug: "a" };

describe("scopeArgs", () => {
  it.each([
    "findMany",
    "findFirst",
    "findUnique",
    "count",
    "aggregate",
    "groupBy",
    "delete",
    "deleteMany",
  ])("%s adds the tenant to the filter", (op) => {
    expect(scopeArgs("Membership", op, { where: { id: "x" } }, A)).toEqual({
      where: { id: "x", tenantId: "tenant-a" },
    });
  });

  it("adds a filter when the query has none", () => {
    expect(scopeArgs("Membership", "findMany", {}, A)).toEqual({ where: { tenantId: "tenant-a" } });
  });

  it("create sets tenantId from the context", () => {
    expect(scopeArgs("Membership", "create", { data: { role: "student" } }, A)).toEqual({
      data: { role: "student", tenantId: "tenant-a" },
    });
  });

  it("createMany sets tenantId on every row", () => {
    const out = scopeArgs(
      "Membership",
      "createMany",
      { data: [{ userId: "1" }, { userId: "2" }] },
      A,
    );
    expect(out["data"]).toEqual([
      { userId: "1", tenantId: "tenant-a" },
      { userId: "2", tenantId: "tenant-a" },
    ]);
  });

  it("update scopes the filter and keeps the data", () => {
    expect(
      scopeArgs("Membership", "update", { where: { id: "x" }, data: { phone: "1" } }, A),
    ).toEqual({
      where: { id: "x", tenantId: "tenant-a" },
      data: { phone: "1" },
    });
  });

  it("upsert scopes the filter and the create data", () => {
    const out = scopeArgs(
      "Membership",
      "upsert",
      { where: { id: "x" }, create: { role: "student" }, update: {} },
      A,
    );
    expect(out).toMatchObject({
      where: { id: "x", tenantId: "tenant-a" },
      create: { role: "student", tenantId: "tenant-a" },
    });
  });

  it.each([
    ["create with another tenantId", "create", { data: { tenantId: "tenant-b" } }],
    [
      "create through the tenant relation",
      "create",
      { data: { tenant: { connect: { id: "tenant-b" } } } },
    ],
    ["filter on another tenant", "findMany", { where: { tenantId: "tenant-b" } }],
    [
      "update moving a row to another tenant",
      "update",
      { where: { id: "x" }, data: { tenantId: "tenant-b" } },
    ],
    [
      "upsert moving a row to another tenant",
      "upsert",
      { where: { id: "x" }, create: {}, update: { tenantId: "tenant-b" } },
    ],
  ])("rejects %s with TENANT_MISMATCH", (_label, op, args) => {
    expect(() => scopeArgs("Membership", op, args, A)).toThrow(
      expect.objectContaining({ code: "TENANT_MISMATCH" }),
    );
  });

  it("throws NO_TENANT_CONTEXT outside a request", () => {
    expect(() => scopeArgs("Membership", "findMany", {}, undefined)).toThrow(
      expect.objectContaining({ code: "NO_TENANT_CONTEXT" }),
    );
  });

  it("fails closed on an operation it cannot scope", () => {
    expect(() => scopeArgs("Membership", "findRaw", {}, A)).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_OPERATION" }),
    );
  });

  it("passes admin-context queries through unchanged", () => {
    const args = { where: { tenantId: "tenant-b" } };
    expect(scopeArgs("Membership", "findMany", args, { kind: "admin" })).toBe(args);
  });

  it("does not touch models without a tenant", () => {
    const args = { where: { slug: "a" } };
    expect(scopeArgs("Tenant", "findFirst", args, undefined)).toBe(args);
  });
});

// Global tables that carry a tenantId but must never be tenant-filtered. Keep this list short.
// Session: tenantId only records the subdomain the session was opened on; the one-session
// rule must see a student's sessions on every tenant (docs/05-auth-devices.md §3).
const GLOBAL_MODELS_WITH_TENANT_ID = new Set(["Session"]);

describe("TENANT_MODELS", () => {
  it("lists every model with a tenantId column in schema.prisma", () => {
    const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
    const withTenantId = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+tenantId\s/m.test(body ?? ""))
      .map(([, name]) => name)
      .filter((name) => !GLOBAL_MODELS_WITH_TENANT_ID.has(name ?? ""));
    expect(withTenantId.length).toBeGreaterThan(0);
    expect([...TENANT_MODELS].sort()).toEqual(withTenantId.sort());
  });
});
