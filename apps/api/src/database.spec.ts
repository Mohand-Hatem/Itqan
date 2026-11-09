import { describe, expect, it } from "vitest";
import { createPrismaClient, PrismaClient } from "@itqan/database";

describe("@itqan/database in the API", () => {
  it("resolves the shared Prisma client", () => {
    expect(typeof createPrismaClient).toBe("function");
    expect(typeof PrismaClient).toBe("function");
  });
});
