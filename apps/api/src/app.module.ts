import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { MeModule } from "./me/me.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

@Module({
  imports: [DatabaseModule, TenancyModule, AuditModule, AuthModule, MeModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
