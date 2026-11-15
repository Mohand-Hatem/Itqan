import { Inject, Injectable, Logger } from "@nestjs/common";
import { runWithContext, type ScopedPrismaClient, systemPrisma } from "@itqan/database";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import {
  examOpeningNotification,
  gradeReleasedNotification,
} from "../notifications/notification-inputs.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { StorageService } from "../storage/storage.service.js";

const DAY_MS = 24 * 3600 * 1000;

/** Expired, unused invitations stay this long so staff can still resend them (owner, 2026-11-15). */
export const INVITATION_RETENTION_DAYS = 30;
/** A presigned PUT lives 15 minutes; a day later the upload is not coming. */
export const PENDING_UPLOAD_MAX_AGE_MS = DAY_MS;
/** FR-T04: soft-deleted tenants are purged after 30 days. */
export const TENANT_PURGE_AFTER_DAYS = 30;

type TenantRef = { id: string; slug: string };

/**
 * Scheduled jobs (step 10.1, docs/03 §6). Each method is idempotent: it claims its work with a
 * conditional write, so a second run (or a second server) finds nothing left. Jobs are never the
 * only authority; exam windows and grade visibility are still checked on every read.
 * Called by JobsScheduler on a timer, and directly by tests.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /** Hourly: expired sessions, and unused invitations expired more than 30 days ago. */
  async cleanupExpired(now = new Date()) {
    // Both tables are read across tenants with the system client (no request here).
    const sessions = await systemPrisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    const invitations = await systemPrisma.invitation.deleteMany({
      where: {
        redeemedAt: null,
        expiresAt: { lt: new Date(now.getTime() - INVITATION_RETENTION_DAYS * DAY_MS) },
      },
    });
    return { sessions: sessions.count, invitations: invitations.count };
  }

  /**
   * Every minute: grades that release at close time (on_close, and all_submitted falling back
   * to close time). Students with a submitted attempt get a notification and an email (FR-N03).
   */
  async notifyGradeReleases(now = new Date()) {
    const due = await systemPrisma.quiz.findMany({
      where: {
        releaseNotifiedAt: null,
        deletedAt: null,
        publishedAt: { not: null },
        gradeRelease: { in: ["on_close", "all_submitted"] },
        closesAt: { lte: now },
        tenant: { status: "active" },
      },
      select: { id: true, tenant: { select: { id: true, slug: true } } },
      take: 100,
    });

    let notified = 0;
    for (const quiz of due) {
      notified += await this.safely(`grade release ${quiz.id}`, () =>
        this.inTenant(quiz.tenant, async () => {
          const afterCommit = await this.db.$transaction(async (tx) => {
            const claimed = await tx.quiz.updateMany({
              where: { id: quiz.id, releaseNotifiedAt: null },
              data: { releaseNotifiedAt: now },
            });
            if (claimed.count === 0) return null;
            const row = await tx.quiz.findUniqueOrThrow({
              where: { id: quiz.id },
              select: { id: true, title: true },
            });
            const submitted = await tx.attempt.findMany({
              where: { quizId: quiz.id, submittedAt: { not: null } },
              distinct: ["membershipId"],
              select: { membership: { select: { userId: true } } },
            });
            return this.notifications.stage(
              tx,
              submitted.map((a) => gradeReleasedNotification(a.membership.userId, row)),
            );
          });
          afterCommit?.();
          return afterCommit ? 1 : 0;
        }),
      );
    }
    return { quizzes: notified };
  }

  /** Every minute: "exam opening" for published quizzes whose window just opened (FR-N03). */
  async notifyExamOpenings(now = new Date()) {
    const due = await systemPrisma.quiz.findMany({
      where: {
        openingNotifiedAt: null,
        deletedAt: null,
        publishedAt: { not: null },
        opensAt: { lte: now },
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
        tenant: { status: "active" },
      },
      select: { id: true, tenant: { select: { id: true, slug: true } } },
      take: 100,
    });

    let notified = 0;
    for (const quiz of due) {
      notified += await this.safely(`exam opening ${quiz.id}`, () =>
        this.inTenant(quiz.tenant, async () => {
          const afterCommit = await this.db.$transaction(async (tx) => {
            const claimed = await tx.quiz.updateMany({
              where: { id: quiz.id, openingNotifiedAt: null },
              data: { openingNotifiedAt: now },
            });
            if (claimed.count === 0) return null;
            const row = await tx.quiz.findUniqueOrThrow({
              where: { id: quiz.id },
              select: {
                id: true,
                title: true,
                courseId: true,
                durationMin: true,
                opensAt: true,
                closesAt: true,
                course: { select: { title: true } },
              },
            });
            // Same eligibility as the all_submitted check: active students actively enrolled.
            const enrolled = await tx.enrollment.findMany({
              where: {
                courseId: row.courseId,
                status: "active",
                membership: { status: "active", role: "student" },
              },
              select: { membership: { select: { userId: true } } },
            });
            return this.notifications.stage(
              tx,
              enrolled.map((e) => examOpeningNotification(e.membership.userId, row)),
            );
          });
          afterCommit?.();
          return afterCommit ? 1 : 0;
        }),
      );
    }
    return { quizzes: notified };
  }

  /** Hourly: pending uploads older than a day are failed and their R2 object removed. */
  async failStalePendingUploads(now = new Date()) {
    const stale = await systemPrisma.mediaAsset.findMany({
      where: {
        status: "pending",
        createdAt: { lt: new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS) },
      },
      select: { id: true, purpose: true, storageKey: true },
      take: 500,
    });

    let failed = 0;
    for (const asset of stale) {
      failed += await this.safely(`pending upload ${asset.id}`, async () => {
        // Deleting a key that was never uploaded is not an error in R2.
        await this.storage.delete(
          asset.purpose === "public" ? "public" : "private",
          asset.storageKey,
        );
        const { count } = await systemPrisma.mediaAsset.updateMany({
          where: { id: asset.id, status: "pending" },
          data: { status: "failed" },
        });
        return count;
      });
    }
    return { assets: failed };
  }

  /**
   * Daily: tenants soft-deleted more than 30 days ago (FR-T04). R2 files go first, then every
   * tenant row (cascade). If R2 fails the tenant stays and tomorrow's run tries again.
   */
  async purgeDeletedTenants(now = new Date()) {
    const due = await systemPrisma.tenant.findMany({
      where: {
        status: "deleted",
        deletedAt: { lt: new Date(now.getTime() - TENANT_PURGE_AFTER_DAYS * DAY_MS) },
      },
      select: { id: true, slug: true, deletedAt: true },
    });

    let purged = 0;
    for (const tenant of due) {
      purged += await this.safely(`tenant purge ${tenant.id}`, async () => {
        const prefix = `tenants/${tenant.id}/`;
        const objects =
          (await this.storage.deletePrefix("private", prefix)) +
          (await this.storage.deletePrefix("public", prefix));
        await systemPrisma.$transaction(async (tx) => {
          await tx.tenant.delete({ where: { id: tenant.id } });
          // A platform entry (tenant null), so it survives the cascade it records.
          await this.audit.record(
            {
              action: "tenant.purge",
              tenantId: null,
              targetType: "tenant",
              targetId: tenant.id,
              meta: { slug: tenant.slug, deletedAt: tenant.deletedAt?.toISOString(), objects },
            },
            tx,
          );
        });
        return 1;
      });
    }
    return { tenants: purged };
  }

  private inTenant<T>(tenant: TenantRef, fn: () => Promise<T>): Promise<T> {
    return runWithContext({ kind: "tenant", tenantId: tenant.id, tenantSlug: tenant.slug }, fn);
  }

  /** One bad item must not stop the rest of the batch; it is retried on the next run. */
  private async safely(label: string, fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `Job step failed: ${label}`,
        err instanceof Error ? err.stack : String(err),
      );
      return 0;
    }
  }
}
