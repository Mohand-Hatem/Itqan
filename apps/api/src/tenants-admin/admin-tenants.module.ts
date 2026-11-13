import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AdminTenantsController } from "./admin-tenants.controller.js";
import { AdminTenantsService } from "./admin-tenants.service.js";
import { AdminUsersController } from "./admin-users.controller.js";

@Module({
  imports: [AuthModule, AuditModule, TenancyModule],
  controllers: [AdminTenantsController, AdminUsersController],
  providers: [AdminTenantsService],
  exports: [AdminTenantsService],
})
export class AdminTenantsModule {}
