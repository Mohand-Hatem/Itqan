import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import type { Request } from "express";
import { DeviceRequestsController } from "./device-requests.controller.js";
import { SignOutRequestsController } from "./signout-requests.controller.js";
import { SupportRequestsController } from "./support-requests.controller.js";
import { SupportRequestsService } from "./support-requests.service.js";

// In-memory counters (single API process; no Redis, ADR-003). Limits are set per route with @Throttle.
const byEmail = (req: Record<string, unknown>) => {
  const email = (req as unknown as Request).body?.email;
  return typeof email === "string"
    ? email.trim().toLowerCase()
    : String((req as unknown as Request).ip);
};

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: "email", ttl: 60 * 60 * 1000, limit: 3, getTracker: byEmail },
      { name: "ip", ttl: 60 * 60 * 1000, limit: 10 },
    ]),
  ],
  controllers: [DeviceRequestsController, SignOutRequestsController, SupportRequestsController],
  providers: [SupportRequestsService],
})
export class SupportModule {}
