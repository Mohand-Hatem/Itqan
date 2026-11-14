import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import {
  CreateGeneralSupportRequestSchema,
  RespondSupportRequestSchema,
  SupportRequestListQuerySchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership, Roles } from "../auth/roles.decorator.js";
import { SupportRequestsService } from "./support-requests.service.js";

/** Support requests (FR-D06, FR-N05, steps 5.8a and 9.8a). */
@Controller("support-requests")
export class SupportRequestsController {
  constructor(@Inject(SupportRequestsService) private readonly service: SupportRequestsService) {}

  @Post()
  @Roles("student", "teacher", "assistant")
  create(
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
  ) {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }
    const parsed = CreateGeneralSupportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid support request body.",
      });
    }
    return this.service.createGeneral(user, parsed.data);
  }

  @Get()
  @Roles("student", "teacher", "assistant")
  list(
    @Query() raw: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
  ) {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }
    const parsed = SupportRequestListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query.",
      });
    }
    if (membership.role === "student") {
      return this.service.listOwn(user.id, parsed.data);
    }
    return this.service.list(parsed.data);
  }

  @Post(":id/approve")
  @Roles("teacher", "assistant")
  @HttpCode(200)
  approve(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.id);
  }

  @Post(":id/reject")
  @Roles("teacher", "assistant")
  @HttpCode(200)
  reject(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, user.id);
  }

  @Post(":id/close")
  @Roles("teacher", "assistant")
  @HttpCode(200)
  close(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = RespondSupportRequestSchema.safeParse(body || {});
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid close request body.",
      });
    }
    return this.service.close(id, user.id, parsed.data.response);
  }
}
