import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { SignOutRequestBodySchema } from "@itqan/shared";
import type { Request } from "express";
import { Public } from "../auth/public.decorator.js";
import { SupportRequestsService } from "./support-requests.service.js";

const HOUR_MS = 60 * 60 * 1000;

@Controller("signout-requests")
@UseGuards(ThrottlerGuard)
export class SignOutRequestsController {
  constructor(@Inject(SupportRequestsService) private readonly service: SupportRequestsService) {}

  /** POST /api/signout-requests (FR-D05). Public: the student is blocked, so the password is checked again. */
  @Public()
  @Post()
  @HttpCode(201)
  // docs/05 §10: 3 per hour per user (by email), plus a per-IP cap against spraying many accounts.
  @Throttle({ email: { limit: 3, ttl: HOUR_MS }, ip: { limit: 10, ttl: HOUR_MS } })
  create(@Body() raw: unknown, @Req() req: Request) {
    const parsed = SignOutRequestBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid request.",
      });
    }
    return this.service.requestSignOutOther(parsed.data, { cookieHeader: req.headers.cookie });
  }
}
