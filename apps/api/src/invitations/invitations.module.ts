import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { GuardianConsentModule } from "../guardian-consent/guardian-consent.module.js";
import {
  AdminInvitationsController,
  InvitationsController,
  RegisterController,
} from "./invitations.controller.js";
import { InvitationsService } from "./invitations.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, GuardianConsentModule],
  controllers: [InvitationsController, RegisterController, AdminInvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
