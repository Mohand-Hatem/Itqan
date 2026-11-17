import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { SkipThrottle, Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import type { z } from "zod";
import type { AuthUser } from "@itqan/auth";
import { getRequestContext } from "@itqan/database";
import {
  GuardianConsentCheckQuerySchema,
  GuardianConsentConfirmSchema,
  GuardianConsentOfflineSchema,
  GuardianConsentRequestSchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { GuardianConsentService } from "./guardian-consent.service.js";

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      statusCode: 400,
      reason: "INVALID_BODY",
      message: "Invalid guardian consent payload.",
      errors: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
    });
  }
  return parsed.data;
}

function tenantIdOrThrow() {
  const context = getRequestContext();
  if (context?.kind !== "tenant") {
    throw new BadRequestException({
      statusCode: 400,
      reason: "TENANT_REQUIRED",
      message: "Open this on the academy's address.",
    });
  }
  return context.tenantId;
}

/** POST /api/me/guardian-consent/request (10R.7): a minor asks their guardian by email. */
@Controller("me/guardian-consent")
export class MyGuardianConsentController {
  constructor(@Inject(GuardianConsentService) private readonly service: GuardianConsentService) {}

  @Post("request")
  @Roles("student")
  @HttpCode(201)
  request(@Body() raw: unknown, @CurrentUser() user: AuthUser, @Headers("host") host: string) {
    const input = parse(GuardianConsentRequestSchema, raw);
    return this.service.request(user.id, input, { userId: user.id, tenantId: tenantIdOrThrow() }, host);
  }
}

/** Staff side (10R.7): teacher, assistant (and the super admin) for a student of this academy. */
@Controller("students/:membershipId/guardian-consent")
@Roles("teacher", "assistant")
export class StudentGuardianConsentController {
  constructor(@Inject(GuardianConsentService) private readonly service: GuardianConsentService) {}

  @Post("request")
  @HttpCode(201)
  async request(
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @Headers("host") host: string,
  ) {
    const input = parse(GuardianConsentRequestSchema, raw);
    const tenantId = tenantIdOrThrow();
    const userId = await this.service.studentOf(membershipId, tenantId);
    return this.service.request(userId, input, { userId: user.id, tenantId }, host);
  }

  /** Offline: a signed form, stored by reference only (no copy, no ID numbers). */
  @Post()
  @HttpCode(201)
  async recordOffline(
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const input = parse(GuardianConsentOfflineSchema, raw);
    const tenantId = tenantIdOrThrow();
    const userId = await this.service.studentOf(membershipId, tenantId);
    return this.service.recordOffline(userId, input, { userId: user.id, tenantId });
  }

  @Post("withdraw")
  @HttpCode(200)
  async withdraw(
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const tenantId = tenantIdOrThrow();
    const userId = await this.service.studentOf(membershipId, tenantId);
    return this.service.withdraw(userId, { userId: user.id, tenantId });
  }
}

/** Public guardian side (10R.7): the token from the email is the only key. 20 tries/hour per IP. */
@Controller("guardian-consent")
@UseGuards(ThrottlerGuard)
@SkipThrottle({ email: true, code: true })
@Throttle({ ip: { limit: 20, ttl: 60 * 60 * 1000 } })
export class PublicGuardianConsentController {
  constructor(@Inject(GuardianConsentService) private readonly service: GuardianConsentService) {}

  @Get("check")
  @Public()
  check(@Query() raw: unknown) {
    return this.service.check(parse(GuardianConsentCheckQuerySchema, raw).token);
  }

  @Post("confirm")
  @Public()
  @HttpCode(200)
  confirm(@Body() raw: unknown, @Req() req: Request) {
    const input = parse(GuardianConsentConfirmSchema, raw);
    return this.service.confirm(input, req.ip ?? null, req.headers["user-agent"] ?? null);
  }
}
