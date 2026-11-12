import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { DEVICE_COOKIE_NAME, deviceCookieOptions } from "@itqan/auth";
import { getRootDomain } from "@itqan/database";
import { DeviceRequestBodySchema } from "@itqan/shared";
import type { Request, Response } from "express";
import { Public } from "../auth/public.decorator.js";
import { SupportRequestsService } from "./support-requests.service.js";

const HOUR_MS = 60 * 60 * 1000;

@Controller("device-requests")
@UseGuards(ThrottlerGuard)
export class DeviceRequestsController {
  constructor(@Inject(SupportRequestsService) private readonly service: SupportRequestsService) {}

  /** POST /api/device-requests (FR-D03). Public: the student is blocked, so the password is checked again. */
  @Public()
  @Post()
  @HttpCode(201)
  // docs/05 §10: 3 per hour per user (by email), plus a per-IP cap against spraying many accounts.
  @Throttle({ email: { limit: 3, ttl: HOUR_MS }, ip: { limit: 10, ttl: HOUR_MS } })
  async create(
    @Body() raw: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = DeviceRequestBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid request.",
      });
    }
    const result = await this.service.requestDeviceChange(parsed.data, {
      cookieHeader: req.headers.cookie,
      userAgent: req.headers["user-agent"],
    });
    if (result.deviceCookie) {
      const { maxAge, ...options } = deviceCookieOptions(getRootDomain());
      res.cookie(DEVICE_COOKIE_NAME, result.deviceCookie, { ...options, maxAge: maxAge * 1000 });
    }
    return { requestId: result.requestId, status: result.status };
  }
}
