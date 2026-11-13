import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { InvitationsController, RegisterController } from "./invitations.controller.js";
import { InvitationsService } from "./invitations.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [InvitationsController, RegisterController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
