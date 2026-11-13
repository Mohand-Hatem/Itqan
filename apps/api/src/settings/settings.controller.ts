import { BadRequestException, Body, Controller, Get, Inject, Patch } from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { TenantSettingsPatchSchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { SettingsService } from "./settings.service.js";

@Controller()
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly service: SettingsService) {}

  /** Branding and public pages for the public site; no login needed. */
  @Get("public/settings")
  @Public()
  getPublic() {
    return this.service.getPublic();
  }

  @Get("settings")
  @Roles("teacher")
  get() {
    return this.service.get();
  }

  @Patch("settings")
  @Roles("teacher")
  update(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = TenantSettingsPatchSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid settings payload.",
      });
    }
    return this.service.update(parsed.data, user.id);
  }
}
