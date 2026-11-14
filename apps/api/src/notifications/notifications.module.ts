import { Global, Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { SseController } from "./sse.controller.js";
import { SseService } from "./sse.service.js";

@Global()
@Module({
  controllers: [NotificationsController, SseController],
  providers: [NotificationsService, SseService],
  exports: [NotificationsService, SseService],
})
export class NotificationsModule {}
