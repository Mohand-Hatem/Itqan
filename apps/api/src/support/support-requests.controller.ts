import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { SupportRequestListQuerySchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { SupportRequestsService } from "./support-requests.service.js";

/** Staff side of device and sign-out requests (FR-D06). Super admins pass the role check too. */
@Controller("support-requests")
@Roles("teacher", "assistant")
export class SupportRequestsController {
  constructor(@Inject(SupportRequestsService) private readonly service: SupportRequestsService) {}

  @Get()
  list(@Query() raw: unknown) {
    const parsed = SupportRequestListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query.",
      });
    }
    return this.service.list(parsed.data);
  }

  @Post(":id/approve")
  @HttpCode(200)
  approve(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Post(":id/reject")
  @HttpCode(200)
  reject(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, user.id);
  }
}
