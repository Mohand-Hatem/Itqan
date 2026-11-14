import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { EnrollmentsModule } from "../enrollments/enrollments.module.js";
import { AttemptsController } from "./attempts.controller.js";
import { AttemptsService } from "./attempts.service.js";
import { QuizzesController } from "./quizzes.controller.js";
import { QuizzesService } from "./quizzes.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, EnrollmentsModule],
  controllers: [QuizzesController, AttemptsController],
  providers: [QuizzesService, AttemptsService],
  exports: [QuizzesService, AttemptsService],
})
export class QuizzesModule {}
