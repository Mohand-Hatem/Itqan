export const DATABASE_VERSION = "0.1.0";

export { createPrismaClient, prisma, systemPrisma } from "./client.js";
export { getRequestContext, runWithContext, type RequestContext } from "./context.js";
export {
  type ScopedPrismaClient,
  TENANT_MODELS,
  TenantScopeError,
  withTenantScope,
} from "./tenant-extension.js";
export { createTestClient } from "./test-client.js";
export { createTwoTenants, type FixtureTenant, TENANT_FIXTURES } from "./testing/fixtures.js";
export { PrismaClient } from "./generated/prisma/client.js";
