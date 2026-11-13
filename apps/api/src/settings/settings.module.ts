import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SettingsController } from "./settings.controller.js";
import { SettingsService } from "./settings.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, StorageModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
