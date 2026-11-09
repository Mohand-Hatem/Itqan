import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithContext } from "../context.js";
import { TENANT_MODELS, withTenantScope } from "../tenant-extension.js";
import { createTestClient } from "../test-client.js";
import { createTwoTenants, type FixtureTenant, TENANT_FIXTURES } from "./fixtures.js";

// The operations every tenant-owned delegate supports, typed loosely for the sweep.
type Delegate = {
  findMany(args?: object): Promise<{ id: string }[]>;
  count(args?: object): Promise<number>;
  findUnique(args: object): Promise<{ id: string } | null>;
  updateMany(args: object): Promise<{ count: number }>;
  deleteMany(args: object): Promise<{ count: number }>;
};

const raw = createTestClient();
const scoped = withTenantScope(raw);
const delegate = (client: object, model: string) =>
  (client as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)]!;

let a: FixtureTenant;
let b: FixtureTenant;
let cleanup: () => Promise<unknown>;

const asA = <T>(fn: () => Promise<T>) =>
  runWithContext({ kind: "tenant", tenantId: a.id, tenantSlug: a.slug }, async () => await fn());

beforeAll(async () => {
  ({ a, b, cleanup } = await createTwoTenants(raw));
});

afterAll(async () => {
  await cleanup();
  await raw.$disconnect();
});

describe("isolation fixtures", () => {
  it("has a fixture for every tenant-owned model", () => {
    expect(Object.keys(TENANT_FIXTURES).sort()).toEqual([...TENANT_MODELS].sort());
  });
});

describe.each([...TENANT_MODELS])("tenant isolation sweep: %s (integration)", (model) => {
  it("lists and counts only tenant A's rows", async () => {
    const rows = await asA(() => delegate(scoped, model).findMany({ select: { id: true } }));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a.rows[model]);
    expect(ids).not.toContain(b.rows[model]);
    expect(await asA(() => delegate(scoped, model).count())).toBe(ids.length);
  });

  it("cannot read tenant B's row by its id", async () => {
    const found = await asA(() =>
      delegate(scoped, model).findUnique({ where: { id: b.rows[model] } }),
    );
    expect(found).toBeNull();
  });

  it("cannot update or delete tenant B's row", async () => {
    const where = { id: b.rows[model] };
    expect((await asA(() => delegate(scoped, model).updateMany({ where, data: {} }))).count).toBe(
      0,
    );
    expect((await asA(() => delegate(scoped, model).deleteMany({ where }))).count).toBe(0);
    // Checked with the raw client: B's row is still there.
    expect(await delegate(raw, model).findUnique({ where })).not.toBeNull();
  });
});
