import { Global, Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module.js";
import { AuditService } from "./audit.service.js";

// Global: every feature module records admin actions without importing this module.
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
