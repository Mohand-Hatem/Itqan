import { Module } from "@nestjs/common";
import {
  MyGuardianConsentController,
  PublicGuardianConsentController,
  StudentGuardianConsentController,
} from "./guardian-consent.controller.js";
import { GuardianConsentService } from "./guardian-consent.service.js";

@Module({
  controllers: [MyGuardianConsentController, StudentGuardianConsentController, PublicGuardianConsentController],
  providers: [GuardianConsentService],
  exports: [GuardianConsentService],
})
export class GuardianConsentModule {}
