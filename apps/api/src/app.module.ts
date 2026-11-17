import { Module } from "@nestjs/common";
import { AdminTenantsModule } from "./tenants-admin/admin-tenants.module.js";
import { AssistantsModule } from "./assistants/assistants.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CoursesModule } from "./courses/courses.module.js";
import { CodeBatchesModule } from "./code-batches/code-batches.module.js";
import { EnrollmentsModule } from "./enrollments/enrollments.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { GuardianConsentModule } from "./guardian-consent/guardian-consent.module.js";
import { HealthController } from "./health/health.controller.js";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { MeModule } from "./me/me.module.js";
import { StudentsModule } from "./students/students.module.js";
import { SupportModule } from "./support/support.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";
import { UploadsModule } from "./uploads/uploads.module.js";
import { ContentItemsModule } from "./content-items/content-items.module.js";
import { ProgressModule } from "./progress/progress.module.js";
import { SettingsModule } from "./settings/settings.module.js";
import { QuestionBanksModule } from "./question-banks/question-banks.module.js";
import { QuestionsModule } from "./questions/questions.module.js";
import { QuizzesModule } from "./quizzes/quizzes.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { AnnouncementsModule } from "./announcements/announcements.module.js";
import { CommentsModule } from "./comments/comments.module.js";
import { AnalyticsModule } from "./analytics/analytics.module.js";
import { JobsModule } from "./jobs/jobs.module.js";

@Module({
  imports: [
    DatabaseModule,
    TenancyModule,
    AuditModule,
    AuthModule,
    MeModule,
    SupportModule,
    StudentsModule,
    CoursesModule,
    InvitationsModule,
    CodeBatchesModule,
    GuardianConsentModule,
    EnrollmentsModule,
    AssistantsModule,
    AdminTenantsModule,
    UploadsModule,
    ContentItemsModule,
    ProgressModule,
    SettingsModule,
    QuestionBanksModule,
    QuestionsModule,
    QuizzesModule,
    NotificationsModule,
    AnnouncementsModule,
    CommentsModule,
    AnalyticsModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
