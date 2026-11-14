import { randomUUID } from "node:crypto";
import * as auth from "@itqan/auth";
import { runWithContext, systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { NotificationsService } from "./notifications.service.js";

let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let notificationsService: NotificationsService;
let tenantId: string;
let tenantSlug: string;
let tenantHost: string;
let studentUserId: string;
let studentEmail: string;

const createdUserIds: string[] = [];

describe("Notifications Email Integration", () => {
  beforeAll(async () => {
    http = await createHttpTestApp(AppModule);
    notificationsService = http.app.get(NotificationsService);

    tenantSlug = `notif-email-${randomUUID().slice(0, 8)}`;
    tenantHost = `${tenantSlug}.localhost`;
    const t = await systemPrisma.tenant.create({
      data: { name: `Email Test Tenant ${tenantSlug}`, slug: tenantSlug },
    });
    tenantId = t.id;

    studentEmail = `student-email-${randomUUID().slice(0, 8)}@example.com`;
    const password = "StrongPassword123!";
    const signUp = await auth.auth.api.signUpEmail({
      body: { email: studentEmail, password, name: "عمر الفاروق" },
    });
    studentUserId = signUp.user.id;
    createdUserIds.push(studentUserId);

    await systemPrisma.membership.create({
      data: { tenantId, userId: studentUserId, role: "student" },
    });
  });

  afterAll(async () => {
    await http.close();

    if (createdUserIds.length > 0) {
      await systemPrisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.membership.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
    }

    if (tenantId) {
      await systemPrisma.tenant.delete({ where: { id: tenantId } });
    }

    if (createdUserIds.length > 0) {
      await systemPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  });

  describe("post-commit dispatch (Gate G3)", () => {
    it("dispatches grade_released email post-commit with score and quiz details", async () => {
      auth.clearTestMailbox();

      await runWithContext(
        { kind: "tenant", tenantId, tenantSlug },
        async () => {
          await notificationsService.withTransaction(async (tx, postCommit) => {
            await notificationsService.create(
              {
                userId: studentUserId,
                type: "grade_released",
                title: "تم نشر درجة الاختبار",
                body: "لقد حصلت على 90%",
                data: {
                  quizTitle: "اختبار أحكام التجويد",
                  courseTitle: "التجويد الميسر",
                  score: 90,
                  maxScore: 100,
                  percentage: 90,
                  passed: true,
                  reviewUrl: `https://${tenantHost}/quizzes/q1/review`,
                },
                sendEmail: true,
              },
              tx,
              postCommit,
            );

            // While inside the transaction before commit, postCommit callback has not run yet
            expect(auth.getLastSentEmail(studentEmail)).toBeUndefined();
          });
        },
      );

      // Post-commit: Email has been dispatched
      const sent = auth.getLastSentEmail(studentEmail);
      expect(sent).toBeDefined();
      expect(sent?.type).toBe("grade_released");
      expect(sent?.to).toBe(studentEmail);
      expect(sent?.subject).toContain("تم رصد درجة اختبار اختبار أحكام التجويد");
      expect(sent?.html).toContain("90 من 100");
      expect(sent?.html).toContain("ناجح");
      expect(sent?.html).toContain(`https://${tenantHost}/quizzes/q1/review`);
    });

    it("dispatches exam_opening email in English when locale is en", async () => {
      auth.clearTestMailbox();

      await runWithContext(
        { kind: "tenant", tenantId, tenantSlug },
        async () => {
          await notificationsService.withTransaction(async (tx, postCommit) => {
            await notificationsService.create(
              {
                userId: studentUserId,
                type: "exam_opening",
                title: "Exam Opened",
                body: "The final exam is open",
                data: {
                  quizTitle: "Midterm Exam",
                  durationMin: 60,
                  examUrl: `https://${tenantHost}/quizzes/q2/take`,
                },
                sendEmail: true,
                emailOptions: { locale: "en" },
              },
              tx,
              postCommit,
            );
          });
        },
      );

      const sent = auth.getLastSentEmail(studentEmail);
      expect(sent).toBeDefined();
      expect(sent?.type).toBe("exam_opening");
      expect(sent?.subject).toContain("Exam Now Open: Midterm Exam");
      expect(sent?.html).toContain('dir="ltr"');
      expect(sent?.html).toContain('lang="en"');
      expect(sent?.html).toContain("60 minutes");
      expect(sent?.html).toContain(`https://${tenantHost}/quizzes/q2/take`);
    });

    it("dispatches course_access and device_request_decided emails post-commit", async () => {
      auth.clearTestMailbox();

      await runWithContext(
        { kind: "tenant", tenantId, tenantSlug },
        async () => {
          // Course access
          await notificationsService.withTransaction(async (tx, postCommit) => {
            await notificationsService.create(
              {
                userId: studentUserId,
                type: "course_access",
                title: "تفعيل الدورة",
                body: "تم تفعيل دورتك",
                data: {
                  courseTitle: "تفسير سورة الكهف",
                  courseUrl: `https://${tenantHost}/courses/c1`,
                },
                sendEmail: true,
              },
              tx,
              postCommit,
            );
          });

          // Device request decided
          await notificationsService.withTransaction(async (tx, postCommit) => {
            await notificationsService.create(
              {
                userId: studentUserId,
                type: "device_request_decided",
                title: "تمت الموافقة على الطلب",
                body: "تم قبول طلب تغيير جهازك",
                data: {
                  status: "approved",
                  requestType: "device_change",
                  loginUrl: `https://${tenantHost}/login`,
                },
                sendEmail: true,
              },
              tx,
              postCommit,
            );
          });
        },
      );

      expect(auth.testMailbox.length).toBe(2);

      const courseEmail = auth.testMailbox.find((m) => m.type === "course_access");
      expect(courseEmail).toBeDefined();
      expect(courseEmail?.subject).toContain("تفسير سورة الكهف");
      expect(courseEmail?.html).toContain(`https://${tenantHost}/courses/c1`);

      const deviceEmail = auth.testMailbox.find((m) => m.type === "device_request_decided");
      expect(deviceEmail).toBeDefined();
      expect(deviceEmail?.subject).toContain("تمت الموافقة على طلب تغيير الجهاز");
      expect(deviceEmail?.html).toContain(`https://${tenantHost}/login`);
    });

    it("discards post-commit email dispatch if database transaction aborts or throws", async () => {
      auth.clearTestMailbox();

      const runFailingTransaction = async () => {
        await runWithContext(
          { kind: "tenant", tenantId, tenantSlug },
          async () => {
            await notificationsService.withTransaction(async (tx, postCommit) => {
              await notificationsService.create(
                {
                  userId: studentUserId,
                  type: "grade_released",
                  title: "Rollback Test",
                  body: "This should not be sent",
                  data: { quizTitle: "Aborted Quiz" },
                  sendEmail: true,
                },
                tx,
                postCommit,
              );

              // Force transaction failure
              throw new Error("Simulated database failure during transaction");
            });
          },
        );
      };

      await expect(runFailingTransaction()).rejects.toThrow("Simulated database failure");

      // Verify no email was dispatched
      expect(auth.testMailbox.length).toBe(0);

      // Verify no notification was committed to database
      const count = await systemPrisma.notification.count({
        where: { title: "Rollback Test" },
      });
      expect(count).toBe(0);
    });
  });

  describe("delivery failure (Gate G4)", () => {
    it("catches delivery failure when mail client fails, keeping transaction and database rows committed", async () => {
      auth.clearTestMailbox();

      const sendSpy = vi
        .spyOn(auth, "sendGradeReleasedEmail")
        .mockRejectedValueOnce(new Error("Resend rate limit exceeded (429)"));

      let savedNotifId: string | undefined;

      await runWithContext(
        { kind: "tenant", tenantId, tenantSlug },
        async () => {
          // Should NOT throw even though the email delivery fails in postCommit
          const result = await notificationsService.withTransaction(async (tx, postCommit) => {
            const notif = await notificationsService.create(
              {
                userId: studentUserId,
                type: "grade_released",
                title: "Resilient Notification",
                body: "Body text",
                data: { quizTitle: "Resilient Quiz" },
                sendEmail: true,
              },
              tx,
              postCommit,
            );
            savedNotifId = notif.id;
            return notif;
          });

          expect(result.id).toBeDefined();
        },
      );

      sendSpy.mockRestore();

      // Database transaction stayed intact and notification exists
      expect(savedNotifId).toBeDefined();
      const dbRow = await systemPrisma.notification.findUnique({
        where: { id: savedNotifId },
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow?.title).toBe("Resilient Notification");
    });

    it("catches email error when user has no email address without crashing", async () => {
      const ghostUserId = randomUUID();

      await runWithContext(
        { kind: "tenant", tenantId, tenantSlug },
        async () => {
          const dispatchRes = await notificationsService.dispatchEmail({
            userId: ghostUserId,
            type: "grade_released",
            title: "Ghost User",
          });

          expect(dispatchRes.error).toBeDefined();
        },
      );
    });
  });
});
