import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import {
  AccessReasonCode,
  InvitationAcceptSchema,
  InvitationCheckQuerySchema,
  InvitationCreateSchema,
  InvitationListQuerySchema,
  InvitationRegisterSchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { InvitationsService } from "./invitations.service.js";

@Controller("invitations")
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly service: InvitationsService) {}

  @Post()
  @Roles("teacher", "assistant")
  @HttpCode(201)
  create(
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @Headers("host") host: string = "localhost",
  ) {
    const parsed = InvitationCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid invitation payload.",
      });
    }
    return this.service.create(parsed.data, user.id, host);
  }

  @Get()
  @Roles("teacher", "assistant")
  list(@Query() raw: unknown) {
    const parsed = InvitationListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
      });
    }
    return this.service.list(parsed.data);
  }

  @Get("check")
  @Public()
  check(@Query() raw: unknown) {
    const parsed = InvitationCheckQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_TOKEN",
        message: "Invalid invitation token parameter.",
      });
    }
    return this.service.check(parsed.data.token);
  }

  @Post(":id/resend")
  @Roles("teacher", "assistant")
  @HttpCode(200)
  resend(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @Headers("host") host: string = "localhost",
  ) {
    return this.service.resend(id, user.id, host);
  }

  @Post(":id/revoke")
  @Roles("teacher", "assistant")
  @HttpCode(200)
  revoke(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, user.id);
  }

  @Post("accept")
  @Public()
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser | undefined, @Body() raw: unknown) {
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        reason: "UNAUTHORIZED",
        message: "You must be signed in to accept this invitation.",
      });
    }
    if (user.status === "suspended") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AccessReasonCode.USER_SUSPENDED,
        message: "Your account is suspended.",
      });
    }
    const parsed = InvitationAcceptSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid invitation acceptance payload.",
      });
    }
    return this.service.accept(parsed.data, user);
  }
}

@Controller("register")
export class RegisterController {
  constructor(@Inject(InvitationsService) private readonly service: InvitationsService) {}

  @Post()
  @Public()
  @HttpCode(201)
  register(@Body() raw: unknown) {
    const parsed = InvitationRegisterSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid registration payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.register(parsed.data);
  }
}
