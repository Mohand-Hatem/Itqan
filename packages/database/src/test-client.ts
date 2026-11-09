import { createPrismaClient } from "./client.js";
import type { PrismaClient } from "./generated/prisma/client.js";

// Client for integration tests: always the itqan_test database, never dev data.
export function createTestClient(): PrismaClient {
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up`.",
    );
  }
  return createPrismaClient(url);
}
