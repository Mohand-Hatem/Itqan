import { afterAll, describe, expect, it } from "vitest";
import { createTestClient } from "./test-client.js";

const db = createTestClient();
afterAll(() => db.$disconnect());

describe("database connection (integration)", () => {
  it("runs a query against the test database", async () => {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
    expect(rows).toEqual([{ ok: 1 }]);
  });

  // Later tests wipe tables, so they must never point at the dev database.
  it("is connected to itqan_test, not the dev database", async () => {
    const [row] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
    expect(row?.name).toBe("itqan_test");
  });
});
