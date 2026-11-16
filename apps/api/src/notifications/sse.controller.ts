import { randomUUID } from "node:crypto";
import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { AuthSession, AuthUser } from "@itqan/auth";
import { getRequestContext } from "@itqan/database";
import type { Request, Response } from "express";
import { CurrentSession, CurrentUser } from "../auth/current-user.decorator.js";
import { SseService } from "./sse.service.js";

@Controller()
export class SseController {
  constructor(@Inject(SseService) private readonly sseService: SseService) {}

  @Get(["sse", "notifications/stream"])
  stream(
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession,
    @Req() _req: Request,
    @Res() res: Response,
  ) {
    const ctx = getRequestContext();
    const tenantId = ctx?.kind === "tenant" ? ctx.tenantId : "";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    this.sseService.registerConnection({
      id: randomUUID(),
      userId: user.id,
      tenantId,
      deviceId: session?.deviceId ?? null,
      sessionId: session?.id ?? null,
      res,
      connectedAt: new Date(),
    });
  }
}
