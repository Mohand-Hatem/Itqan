import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { TenancyModule } from "./tenancy/tenancy.module";

@Module({
  imports: [DatabaseModule, TenancyModule, AuditModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
