import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { type ScopedPrismaClient, withTenantScope } from "./tenant-extension.js";

export function createPrismaClient(connectionString: string): PrismaClient {
  const max = parseInt(process.env["DB_POOL_MAX"] || "30", 10);
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

// One client per process. Next.js dev reloads modules on every save, so the
// instance is kept on globalThis to avoid opening a new connection pool each time.
const globalForPrisma = globalThis as unknown as { itqanPrisma?: PrismaClient };

// Raw client with no tenant filter. Only for code that runs outside a request:
// seed script, scheduled jobs, tenant lookup by host.
export const systemPrisma: PrismaClient =
  globalForPrisma.itqanPrisma ?? createPrismaClient(process.env["DATABASE_URL"] ?? "");

if (process.env["NODE_ENV"] !== "production") globalForPrisma.itqanPrisma = systemPrisma;

// Default client for app code: every query on a tenant-owned table is limited
// to the current request's tenant (tenant-extension.ts).
export const prisma: ScopedPrismaClient = withTenantScope(systemPrisma);
