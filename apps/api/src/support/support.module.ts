import { randomUUID } from "node:crypto";
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

// Access-code routes (step 10.3): one code may be tried 5 times per 15 min from anywhere, so it
// cannot be used to test many emails. Requests without a code never share a bucket.
const byCode = (req: Record<string, unknown>) => {
  const code = (req as unknown as Request).body?.code;
  return typeof code === "string" ? code.toUpperCase().replace(/[^0-9A-Z]/g, "") : randomUUID();
};

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: "email", ttl: 60 * 60 * 1000, limit: 3, getTracker: byEmail },
      { name: "ip", ttl: 60 * 60 * 1000, limit: 10 },
      { name: "code", ttl: 15 * 60 * 1000, limit: 5, getTracker: byCode },
    ]),
  ],
  controllers: [DeviceRequestsController, SignOutRequestsController, SupportRequestsController],
  providers: [SupportRequestsService],
})
export class SupportModule {}
