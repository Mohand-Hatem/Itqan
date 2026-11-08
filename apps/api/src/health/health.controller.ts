import { Controller, Get } from "@nestjs/common";
import { HealthCheckSchema, type HealthCheck } from "@itqan/shared";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthCheck {
    const data = {
      status: "ok" as const,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
    return HealthCheckSchema.parse(data);
  }
}
