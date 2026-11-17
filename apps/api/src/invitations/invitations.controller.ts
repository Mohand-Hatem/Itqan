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
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import {
  AccessReasonCode,
  InvitationAcceptSchema,
  InvitationAcceptWithPasswordSchema,
  InvitationCheckQuerySchema,
  InvitationCreateSchema,
  InvitationListQuerySchema,
  InvitationRegisterSchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { CurrentMembership, Roles, SuperAdminOnly } from "../auth/roles.decorator.js";
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
    @CurrentMembership() membership?: Membership,
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
    const actor = {
      userId: user.id,
      isSuperAdmin: Boolean(user.isSuperAdmin),
      role: membership?.role,
    };
    return this.service.create(parsed.data, actor, host);
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

  /**
   * POST /api/invitations/accept-with-password (10R.6): for an account that cannot sign in yet
   * (pending). Public; 10 tries per hour per IP, and every try needs the emailed token.
   */
  @Post("accept-with-password")
  @Public()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ email: true, code: true })
  @Throttle({ ip: { limit: 10, ttl: 60 * 60 * 1000 } })
  acceptWithPassword(@Body() raw: unknown) {
    const parsed = InvitationAcceptWithPasswordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid invitation acceptance payload.",
      });
    }
    return this.service.acceptWithPassword(parsed.data);
  }
}

/**
 * POST /api/admin/tenants/:tenantId/invitations (10R.6, FR-E01): the super admin invites any role.
 * The link points at the academy's own address, built from the admin host.
 */
@Controller("admin/tenants/:tenantId/invitations")
@SuperAdminOnly()
export class AdminInvitationsController {
  constructor(@Inject(InvitationsService) private readonly service: InvitationsService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @Headers("host") host: string = "admin.localhost",
  ) {
    const parsed = InvitationCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid invitation payload.",
      });
    }
    const tenantHost = await this.service.tenantHostFor(tenantId, host);
    return this.service.createIn(
      tenantId,
      parsed.data,
      { userId: user.id, isSuperAdmin: true },
      tenantHost,
    );
  }
}

@Controller("register")
export class RegisterController {
  constructor(@Inject(InvitationsService) private readonly service: InvitationsService) {}

  @Post()
  @Public()
  @HttpCode(201)
  register(@Body() raw: unknown, @Headers("host") host: string = "localhost") {
    const parsed = InvitationRegisterSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid registration payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.register(parsed.data, host);
  }
}
