// Step 10.1: scheduled jobs (docs/03 §6). Each job is called directly; running it twice must
// give the same result (idempotent), and the timers themselves are off in tests (JOBS_ENABLED).
import { randomUUID } from "node:crypto";
import { getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type { BucketName, StorageService } from "../storage/storage.service.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";
import {
  INVITATION_RETENTION_DAYS,
  JobsService,
  PENDING_UPLOAD_MAX_AGE_MS,
} from "./jobs.service.js";

const fx = studentFixtures("JobsTestPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let jobs: JobsService;

// R2 is faked: the jobs only need delete calls recorded.
const r2Calls: string[] = [];
const fakeStorage = {
  delete: async (bucket: BucketName, key: string) => void r2Calls.push(`delete ${bucket} ${key}`),
  deletePrefix: async (bucket: BucketName, prefix: string) => {
    r2Calls.push(`prefix ${bucket} ${prefix}`);
    return 0;
  },
} as unknown as StorageService;

const DAY = 24 * 3600 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
  jobs = new JobsService(
    http.app.get(SCOPED_PRISMA),
    http.app.get(NotificationsService),
    http.app.get(AuditService),
    fakeStorage,
  );
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

/** A tenant with a course, a published quiz, and two students (one enrolled). */
async function quizSetup(
  quiz: Partial<{
    gradeRelease: "on_submit" | "all_submitted" | "on_close" | "manual";
    opensAt: Date;
    closesAt: Date | null;
    publishedAt: Date | null;
    openingNotifiedAt: Date | null;
  }>,
) {
  const t = await fx.tenant();
  const enrolled = await fx.member(t.id, "student");
  const outsider = await fx.member(t.id, "student");
  const course = await systemPrisma.course.create({
    data: { tenantId: t.id, title: "Jobs Course" },
  });
  await systemPrisma.enrollment.create({
    data: {
      tenantId: t.id,
      membershipId: enrolled.membership.id,
      courseId: course.id,
      source: "manual",
      grantedBy: enrolled.user.id,
    },
  });
  const row = await systemPrisma.quiz.create({
    data: {
      tenantId: t.id,
      courseId: course.id,
      title: `Jobs Quiz ${randomUUID().slice(0, 6)}`,
      durationMin: 30,
      passMark: 50,
      gradeRelease: quiz.gradeRelease ?? "on_close",
      opensAt: quiz.opensAt ?? ago(2 * 3600_000),
      closesAt: quiz.closesAt === undefined ? ahead(3600_000) : quiz.closesAt,
      publishedAt: quiz.publishedAt === undefined ? ago(3 * 3600_000) : quiz.publishedAt,
      // Opening is already handled unless a test is about it.
      openingNotifiedAt:
        quiz.openingNotifiedAt === undefined ? ago(3600_000) : quiz.openingNotifiedAt,
    },
  });
  return { t, enrolled, outsider, course, quiz: row };
}

async function submittedAttempt(
  tenantId: string,
  quizId: string,
  userId: string,
  membershipId: string,
) {
  const { device } = await fx.device(userId);
  return systemPrisma.attempt.create({
    data: {
      tenantId,
      quizId,
      membershipId,
      deviceId: device.id,
      attemptNo: 1,
      deadlineAt: ago(3600_000),
      submittedAt: ago(3600_000),
      maxScore: 10,
      score: 7,
      passed: true,
      snapshot: {},
    },
  });
}

const notesOf = (userId: string, type: string) =>
  systemPrisma.notification.findMany({ where: { userId, type } });

describe("cleanupExpired (hourly)", () => {
  it("deletes expired sessions, and unused invitations 30 days past expiry; a second run deletes nothing", async () => {
    const t = await fx.tenant();
    const { user } = await fx.member(t.id, "student");
    const teacher = await fx.member(t.id, "teacher");
    const { device } = await fx.device(user.id);
    const live = await fx.session(user.id, device.id, t.id, 3600_000);
    const expired = await fx.session(user.id, device.id, t.id, -60_000);

    const invitation = (expiresAt: Date, redeemedAt: Date | null = null) =>
      systemPrisma.invitation.create({
        data: {
          tenantId: t.id,
          email: `inv-${randomUUID().slice(0, 8)}@example.com`,
          tokenHash: randomUUID(),
          courseIds: [],
          expiresAt,
          redeemedAt,
          createdBy: teacher.user.id,
        },
      });
    const old = await invitation(ago((INVITATION_RETENTION_DAYS + 1) * DAY));
    const recent = await invitation(ago(DAY)); // still resendable
    const redeemed = await invitation(ago(60 * DAY), ago(61 * DAY));

    const first = await jobs.cleanupExpired();
    expect(first.sessions).toBeGreaterThanOrEqual(1);
    expect(first.invitations).toBeGreaterThanOrEqual(1);

    expect(await systemPrisma.session.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await systemPrisma.session.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await systemPrisma.invitation.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await systemPrisma.invitation.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await systemPrisma.invitation.findUnique({ where: { id: redeemed.id } })).not.toBeNull();

    // Idempotent: nothing of ours left to delete.
    await jobs.cleanupExpired();
    expect(await systemPrisma.session.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await systemPrisma.invitation.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});

describe("notifyGradeReleases (every minute)", () => {
  it("on_close: once the quiz closes, students who submitted are notified and emailed, once", async () => {
    const s = await quizSetup({ gradeRelease: "on_close", closesAt: ago(60_000) });
    await submittedAttempt(s.t.id, s.quiz.id, s.enrolled.user.id, s.enrolled.membership.id);

    await jobs.notifyGradeReleases();
    await jobs.notifyGradeReleases();

    expect(await notesOf(s.enrolled.user.id, "grade_released")).toHaveLength(1);
    expect(await notesOf(s.outsider.user.id, "grade_released")).toHaveLength(0);
    await vi.waitFor(() =>
      expect(getLastSentEmail(s.enrolled.user.email)?.type).toBe("grade_released"),
    );
    const quiz = await systemPrisma.quiz.findUniqueOrThrow({ where: { id: s.quiz.id } });
    expect(quiz.releaseNotifiedAt).not.toBeNull();
  });

  it("all_submitted falls back to close time; a still-open quiz is left alone", async () => {
    const closed = await quizSetup({ gradeRelease: "all_submitted", closesAt: ago(60_000) });
    await submittedAttempt(
      closed.t.id,
      closed.quiz.id,
      closed.enrolled.user.id,
      closed.enrolled.membership.id,
    );
    const open = await quizSetup({ gradeRelease: "on_close", closesAt: ahead(3600_000) });
    await submittedAttempt(
      open.t.id,
      open.quiz.id,
      open.enrolled.user.id,
      open.enrolled.membership.id,
    );

    await jobs.notifyGradeReleases();

    expect(await notesOf(closed.enrolled.user.id, "grade_released")).toHaveLength(1);
    expect(await notesOf(open.enrolled.user.id, "grade_released")).toHaveLength(0);
  });

  it("skips quizzes already announced (manual release), unpublished ones and deleted tenants", async () => {
    const announced = await quizSetup({ gradeRelease: "on_close", closesAt: ago(60_000) });
    await systemPrisma.quiz.update({
      where: { id: announced.quiz.id },
      data: { releaseNotifiedAt: ago(1000) },
    });
    await submittedAttempt(
      announced.t.id,
      announced.quiz.id,
      announced.enrolled.user.id,
      announced.enrolled.membership.id,
    );

    const draft = await quizSetup({
      gradeRelease: "on_close",
      closesAt: ago(60_000),
      publishedAt: null,
    });
    await submittedAttempt(
      draft.t.id,
      draft.quiz.id,
      draft.enrolled.user.id,
      draft.enrolled.membership.id,
    );

    const gone = await quizSetup({ gradeRelease: "on_close", closesAt: ago(60_000) });
    await submittedAttempt(
      gone.t.id,
      gone.quiz.id,
      gone.enrolled.user.id,
      gone.enrolled.membership.id,
    );
    await systemPrisma.tenant.update({
      where: { id: gone.t.id },
      data: { status: "deleted", deletedAt: new Date() },
    });

    await jobs.notifyGradeReleases();

    for (const s of [announced, draft, gone]) {
      expect(await notesOf(s.enrolled.user.id, "grade_released")).toHaveLength(0);
    }
  });
});

describe("notifyExamOpenings (every minute)", () => {
  it("tells enrolled students once when a published quiz opens; future and draft quizzes wait", async () => {
    const opened = await quizSetup({ opensAt: ago(60_000), openingNotifiedAt: null });
    const future = await quizSetup({ opensAt: ahead(3600_000), openingNotifiedAt: null });
    const draft = await quizSetup({
      opensAt: ago(60_000),
      openingNotifiedAt: null,
      publishedAt: null,
    });

    await jobs.notifyExamOpenings();
    await jobs.notifyExamOpenings();

    const notes = await notesOf(opened.enrolled.user.id, "exam_opening");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ tenantId: opened.t.id, data: { quizId: opened.quiz.id } });
    expect(await notesOf(opened.outsider.user.id, "exam_opening")).toHaveLength(0);
    expect(await notesOf(future.enrolled.user.id, "exam_opening")).toHaveLength(0);
    expect(await notesOf(draft.enrolled.user.id, "exam_opening")).toHaveLength(0);
    await vi.waitFor(() =>
      expect(getLastSentEmail(opened.enrolled.user.email)?.type).toBe("exam_opening"),
    );
  });
});

describe("failStalePendingUploads (hourly)", () => {
  it("fails pending uploads older than 24 h and deletes their R2 object; fresh and ready ones stay", async () => {
    const t = await fx.tenant();
    const { user } = await fx.member(t.id, "teacher");
    const asset = (
      status: "pending" | "ready",
      createdAt: Date,
      purpose: "content" | "public" = "content",
    ) => {
      const id = randomUUID();
      return systemPrisma.mediaAsset.create({
        data: {
          id,
          tenantId: t.id,
          purpose,
          storageKey: `tenants/${t.id}/${id}`,
          originalName: "file.pdf",
          mimeType: "application/pdf",
          fileSize: 1000,
          status,
          uploadedBy: user.id,
          createdAt,
        },
      });
    };
    const stale = await asset("pending", ago(PENDING_UPLOAD_MAX_AGE_MS + 3600_000));
    const stalePublic = await asset("pending", ago(PENDING_UPLOAD_MAX_AGE_MS + 3600_000), "public");
    const fresh = await asset("pending", ago(3600_000));
    const ready = await asset("ready", ago(10 * DAY));

    await jobs.failStalePendingUploads();
    const callsAfterFirst = r2Calls.filter((c) => c.includes(t.id)).length;
    await jobs.failStalePendingUploads();

    const statusOf = async (id: string) =>
      (await systemPrisma.mediaAsset.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(stale.id)).toBe("failed");
    expect(await statusOf(stalePublic.id)).toBe("failed");
    expect(await statusOf(fresh.id)).toBe("pending");
    expect(await statusOf(ready.id)).toBe("ready");
    expect(r2Calls).toContain(`delete private ${stale.storageKey}`);
    expect(r2Calls).toContain(`delete public ${stalePublic.storageKey}`);
    // Second run: nothing pending and stale is left, so no new R2 calls for this tenant.
    expect(r2Calls.filter((c) => c.includes(t.id)).length).toBe(callsAfterFirst);
  });
});

describe("purgeDeletedTenants (daily, FR-T04)", () => {
  it("purges tenants soft-deleted over 30 days ago (R2 prefix and rows), with an audit entry; recent ones stay", async () => {
    const old = await fx.tenant();
    const recent = await fx.tenant();
    const active = await fx.tenant();
    const oldStudent = await fx.member(old.id, "student");
    const course = await systemPrisma.course.create({ data: { tenantId: old.id, title: "Purged Course" } });
    // Step 10.3 (audit lead purgeDeletedTenants:questions-image-asset-restrict-blocks-tenant-cascade):
    // files referenced by a question image and a lesson (both ON DELETE RESTRICT) must not block the purge.
    const teacher = await fx.member(old.id, "teacher");
    const assetId = randomUUID();
    await systemPrisma.mediaAsset.create({
      data: {
        id: assetId, tenantId: old.id, purpose: "content", storageKey: `tenants/${old.id}/${assetId}`,
        originalName: "a.png", mimeType: "image/png", fileSize: 10, status: "ready", uploadedBy: teacher.user.id,
      },
    });
    const bank = await systemPrisma.questionBank.create({ data: { tenantId: old.id, title: "Bank" } });
    await systemPrisma.question.create({
      data: { tenantId: old.id, bankId: bank.id, type: "single", text: "Q?", imageAssetId: assetId },
    });
    await systemPrisma.contentItem.create({
      data: { tenantId: old.id, courseId: course.id, kind: "file", title: "Lesson file", assetId, sortOrder: 0, depth: 1 },
    });
    await systemPrisma.tenant.update({
      where: { id: old.id },
      data: { status: "deleted", deletedAt: ago(31 * DAY) },
    });
    await systemPrisma.tenant.update({
      where: { id: recent.id },
      data: { status: "deleted", deletedAt: ago(29 * DAY) },
    });

    await jobs.purgeDeletedTenants();
    await jobs.purgeDeletedTenants();

    expect(await systemPrisma.tenant.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await systemPrisma.course.count({ where: { tenantId: old.id } })).toBe(0);
    expect(await systemPrisma.mediaAsset.count({ where: { tenantId: old.id } })).toBe(0);
    expect(await systemPrisma.question.count({ where: { tenantId: old.id } })).toBe(0);
    expect(await systemPrisma.membership.count({ where: { tenantId: old.id } })).toBe(0);
    // The user is global and stays; only the tenant membership goes.
    expect(
      await systemPrisma.user.findUnique({ where: { id: oldStudent.user.id } }),
    ).not.toBeNull();
    expect(await systemPrisma.tenant.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await systemPrisma.tenant.findUnique({ where: { id: active.id } })).not.toBeNull();

    expect(r2Calls).toContain(`prefix private tenants/${old.id}/`);
    expect(r2Calls).toContain(`prefix public tenants/${old.id}/`);
    expect(r2Calls.filter((c) => c.includes(recent.id))).toHaveLength(0);

    const audits = await systemPrisma.auditLog.findMany({
      where: { action: "tenant.purge", targetId: old.id },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.tenantId).toBeNull();
  });
});
