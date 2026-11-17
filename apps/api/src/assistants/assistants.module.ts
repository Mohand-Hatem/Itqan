import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ProvisioningModule } from "../provisioning/provisioning.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { AssistantsController } from "./assistants.controller.js";
import { AssistantsService } from "./assistants.service.js";

@Module({
  imports: [DatabaseModule, AuthModule, AuditModule, ProvisioningModule],
  controllers: [AssistantsController],
  providers: [AssistantsService],
  exports: [AssistantsService],
})
export class AssistantsModule {}
