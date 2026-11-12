export const DATABASE_VERSION = "0.1.0";

export { createPrismaClient, prisma, systemPrisma } from "./client.js";
export { getRequestContext, runWithContext, type RequestContext } from "./context.js";
export {
  type ScopedPrismaClient,
  TENANT_MODELS,
  TenantScopeError,
  withTenantScope,
} from "./tenant-extension.js";
export { createTenantLookup, getRootDomain, type ResolvedTenant } from "./tenant-lookup.js";
export { createTestClient } from "./test-client.js";
export { createTwoTenants, type FixtureTenant, TENANT_FIXTURES } from "./testing/fixtures.js";
export { PrismaClient } from "./generated/prisma/client.js";
export * from "./generated/prisma/enums.js";
export type * from "./generated/prisma/models.js";
export type {
  AccountModel as Account,
  AuditLogModel as AuditLog,
  DeviceModel as Device,
  MembershipModel as Membership,
  SessionModel as Session,
  SupportRequestModel as SupportRequest,
  TenantModel as Tenant,
  TwoFactorModel as TwoFactor,
  UserModel as User,
  VerificationModel as Verification,
} from "./generated/prisma/models.js";
