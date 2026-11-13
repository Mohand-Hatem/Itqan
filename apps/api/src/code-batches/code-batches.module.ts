import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { CodeBatchesController } from "./code-batches.controller.js";
import { CodeBatchesService } from "./code-batches.service.js";
import { CodesController, RegisterWithCodeController } from "./code-redemption.controller.js";
import { CodeRedemptionService } from "./code-redemption.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [CodeBatchesController, RegisterWithCodeController, CodesController],
  providers: [CodeBatchesService, CodeRedemptionService],
  exports: [CodeBatchesService, CodeRedemptionService],
})
export class CodeBatchesModule {}
