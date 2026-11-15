import { Module } from "@nestjs/common";
import { ContentItemsModule } from "../content-items/content-items.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { CommentsController } from "./comments.controller.js";
import { CommentsService } from "./comments.service.js";

@Module({
  imports: [AuditModule, ContentItemsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
