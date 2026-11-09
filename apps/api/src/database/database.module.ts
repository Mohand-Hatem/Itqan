import { Global, Module } from "@nestjs/common";
import { PrismaClient, prisma, systemPrisma } from "@itqan/database";

// Inject SCOPED_PRISMA in services: every query is limited to the request's tenant.
// PrismaClient (raw, no tenant filter) is only for code that runs before a tenant is known.
export const SCOPED_PRISMA = Symbol("SCOPED_PRISMA");

@Global()
@Module({
  providers: [
    { provide: SCOPED_PRISMA, useValue: prisma },
    { provide: PrismaClient, useValue: systemPrisma },
  ],
  exports: [SCOPED_PRISMA, PrismaClient],
})
export class DatabaseModule {}
