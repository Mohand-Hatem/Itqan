// Pattern to copy for every new tenant endpoint: two tenants, act as A over HTTP,
// try to list / read / change B's rows, then check B's data with the raw client.
import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
} from "@nestjs/common";
import {
  createTestClient,
  createTwoTenants,
  type FixtureTenant,
  prisma,
  systemPrisma,
} from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { createHttpTestApp } from "./http.js";

// Test-only memberships endpoint using the scoped `prisma`, like real services will.
// Decorators are plain calls: spec files sit outside apps/api/tsconfig.json.
class MembershipProbeController {
  // Returns the query without `await` on purpose: the lazy-query case from step 2.5.
  list() {
    return prisma.membership.findMany({ select: { id: true, tenantId: true } });
  }

  async get(id: string) {
    const row = await prisma.membership.findUnique({ where: { id } });
    if (!row) throw new NotFoundException();
    return row;
  }

  async update(id: string, body: { phone: string }) {
    const { count } = await prisma.membership.updateMany({
      where: { id },
      data: { phone: body.phone },
    });
    if (!count) throw new NotFoundException();
    return { updated: count };
  }

  async remove(id: string) {
    const { count } = await prisma.membership.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException();
    return { deleted: count };
  }
}
const proto = MembershipProbeController.prototype;
const route = (name: keyof MembershipProbeController, decorator: MethodDecorator) =>
  decorator(proto, name, Object.getOwnPropertyDescriptor(proto, name)!);
route("list", Get());
route("get", Get(":id"));
route("update", Patch(":id"));
route("remove", Delete(":id"));
Param("id")(proto, "get", 0);
Param("id")(proto, "update", 0);
Body()(proto, "update", 1);
Param("id")(proto, "remove", 0);
Controller("membership-probe")(MembershipProbeController);

class TestAppModule {}
Module({ imports: [TenancyModule], controllers: [MembershipProbeController] })(TestAppModule);

const raw = createTestClient();
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let a: FixtureTenant;
let b: FixtureTenant;
let cleanup: () => Promise<unknown>;
const bRow = () => b.rows["Membership"]!;

beforeAll(async () => {
  ({ a, b, cleanup } = await createTwoTenants(raw));
  http = await createHttpTestApp(TestAppModule);
});

afterAll(async () => {
  await http.close();
  await cleanup();
  await raw.$disconnect();
  await systemPrisma.$disconnect();
});

describe("tenant isolation over HTTP (integration)", () => {
  it("lists only the requesting tenant's rows, even when the handler doesn't await", async () => {
    const res = await http.requestAs(a, "GET", "/api/membership-probe");
    expect(res.status).toBe(200);
    const rows = res.body as { id: string; tenantId: string }[];
    expect(rows.map((r) => r.id)).toContain(a.rows["Membership"]);
    expect(rows.every((r) => r.tenantId === a.id)).toBe(true);
  });

  it("returns 404 when A asks for B's row by id", async () => {
    expect((await http.requestAs(a, "GET", `/api/membership-probe/${bRow()}`)).status).toBe(404);
  });

  it("returns 404 when A tries to change or delete B's row, and B's row is unchanged", async () => {
    const patch = await http.requestAs(a, "PATCH", `/api/membership-probe/${bRow()}`, {
      phone: "hacked",
    });
    const del = await http.requestAs(a, "DELETE", `/api/membership-probe/${bRow()}`);
    expect([patch.status, del.status]).toEqual([404, 404]);

    const row = await raw.membership.findUnique({ where: { id: bRow() } });
    expect(row).not.toBeNull();
    expect(row?.phone).toBeNull();
  });

  it("still lets B read and change its own row", async () => {
    expect((await http.requestAs(b, "GET", `/api/membership-probe/${bRow()}`)).status).toBe(200);
    const patch = await http.requestAs(b, "PATCH", `/api/membership-probe/${bRow()}`, {
      phone: "0100",
    });
    expect(patch).toEqual({ status: 200, body: { updated: 1 } });
  });
});
