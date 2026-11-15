import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { JobsScheduler } from "./jobs.scheduler.js";
import { JobsService } from "./jobs.service.js";

// JOBS_ENABLED=false (tests) leaves ScheduleModule out, so the @Cron timers never start.
const timers = process.env["JOBS_ENABLED"] === "false" ? [] : [ScheduleModule.forRoot()];

@Module({
  imports: [...timers, DatabaseModule, AuditModule, StorageModule],
  providers: [JobsService, JobsScheduler],
  exports: [JobsService],
})
export class JobsModule {}
