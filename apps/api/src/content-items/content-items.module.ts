import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { EnrollmentsModule } from "../enrollments/enrollments.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { ContentAccessService } from "./content-access.service.js";
import { ContentItemsController, CourseTreeController } from "./content-items.controller.js";
import { ContentItemsService } from "./content-items.service.js";

@Module({
  imports: [DatabaseModule, AuditModule, EnrollmentsModule, StorageModule],
  controllers: [ContentItemsController, CourseTreeController],
  providers: [ContentItemsService, ContentAccessService],
  exports: [ContentAccessService],
})
export class ContentItemsModule {}
