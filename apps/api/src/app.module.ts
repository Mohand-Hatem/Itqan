import { Module } from "@nestjs/common";
import { AdminTenantsModule } from "./tenants-admin/admin-tenants.module.js";
import { AssistantsModule } from "./assistants/assistants.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CoursesModule } from "./courses/courses.module.js";
import { CodeBatchesModule } from "./code-batches/code-batches.module.js";
import { EnrollmentsModule } from "./enrollments/enrollments.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health/health.controller.js";
import { InvitationsModule } from "./invitations/invitations.module.js";
import { MeModule } from "./me/me.module.js";
import { StudentsModule } from "./students/students.module.js";
import { SupportModule } from "./support/support.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

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
    EnrollmentsModule,
    AssistantsModule,
    AdminTenantsModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
