import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { JobsService } from "./jobs.service.js";

/**
 * Timers for the scheduled jobs (docs/03 §6, ADR-003: @nestjs/schedule, no queue). The timers
 * run only when ScheduleModule is loaded, which JobsModule skips when JOBS_ENABLED=false
 * (tests). A job still running when its next tick comes is skipped, not run twice.
 */
@Injectable()
export class JobsScheduler {
  private readonly logger = new Logger(JobsScheduler.name);
  private readonly running = new Set<string>();

  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  everyMinute() {
    return Promise.all([
      this.run("grade-releases", () => this.jobs.notifyGradeReleases()),
      this.run("exam-openings", () => this.jobs.notifyExamOpenings()),
    ]);
  }

  @Cron(CronExpression.EVERY_HOUR)
  hourly() {
    return Promise.all([
      this.run("cleanup-expired", () => this.jobs.cleanupExpired()),
      this.run("stale-uploads", () => this.jobs.failStalePendingUploads()),
    ]);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  daily() {
    return this.run("tenant-purge", () => this.jobs.purgeDeletedTenants());
  }

  private async run(name: string, job: () => Promise<Record<string, number>>) {
    if (this.running.has(name)) return;
    this.running.add(name);
    try {
      const result = await job();
      if (Object.values(result).some((n) => n > 0))
        this.logger.log(`${name}: ${JSON.stringify(result)}`);
    } catch (err) {
      this.logger.error(`${name} failed`, err instanceof Error ? err.stack : String(err));
    } finally {
      this.running.delete(name);
    }
  }
}
