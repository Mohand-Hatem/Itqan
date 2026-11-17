import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ProvisioningModule } from "../provisioning/provisioning.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { AdminMembersController } from "./admin-members.controller.js";
import { AdminMembersService } from "./admin-members.service.js";
import { AdminTenantsController } from "./admin-tenants.controller.js";
import { AdminTenantsService } from "./admin-tenants.service.js";
import { AdminUsersController } from "./admin-users.controller.js";

@Module({
  imports: [AuthModule, AuditModule, TenancyModule, ProvisioningModule],
  controllers: [AdminTenantsController, AdminUsersController, AdminMembersController],
  providers: [AdminTenantsService, AdminMembersService],
  exports: [AdminTenantsService],
})
export class AdminTenantsModule {}
