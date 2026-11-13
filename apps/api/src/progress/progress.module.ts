import { Module } from "@nestjs/common";
import { ContentItemsModule } from "../content-items/content-items.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { ProgressController } from "./progress.controller.js";
import { ProgressService } from "./progress.service.js";

@Module({
  imports: [DatabaseModule, ContentItemsModule],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
