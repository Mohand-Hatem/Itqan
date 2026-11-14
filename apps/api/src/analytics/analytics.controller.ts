import { Controller, Get, HttpCode, Inject } from "@nestjs/common";
import type { AnalyticsOverviewResponseDto } from "@itqan/shared";
import { Roles } from "../auth/roles.decorator.js";
import { AnalyticsService } from "./analytics.service.js";

/** Analytics overview API (FR-L02, step 9.9a). Staff only. */
@Controller("analytics")
@Roles("teacher", "assistant")
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly service: AnalyticsService) {}

  @Get("overview")
  @HttpCode(200)
  getOverview(): Promise<AnalyticsOverviewResponseDto> {
    return this.service.getOverview();
  }
}
