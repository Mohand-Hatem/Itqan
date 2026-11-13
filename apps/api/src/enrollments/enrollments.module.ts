import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import {
  CourseAccessController,
  EnrollmentsController,
  StudentEnrollmentsController,
} from "./enrollments.controller.js";
import { EnrollmentsService } from "./enrollments.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [StudentEnrollmentsController, EnrollmentsController, CourseAccessController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
