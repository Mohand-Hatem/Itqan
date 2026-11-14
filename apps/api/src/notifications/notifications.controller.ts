import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import {
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  type ListNotificationsResponseDto,
  type MarkNotificationsReadResponseDto,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { NotificationsService } from "./notifications.service.js";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() raw: unknown,
  ): Promise<ListNotificationsResponseDto> {
    const parsed = ListNotificationsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
      });
    }
    return this.notificationsService.list(user.id, parsed.data);
  }

  @Patch("read")
  @HttpCode(200)
  async markRead(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
  ): Promise<MarkNotificationsReadResponseDto> {
    const parsed = MarkNotificationsReadSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid request body.",
      });
    }
    return this.notificationsService.markRead(user.id, parsed.data.ids);
  }
}
