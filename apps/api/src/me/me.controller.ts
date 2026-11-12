import { Controller, Get } from "@nestjs/common";
import type { AuthSession, AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import type { MeResponse } from "@itqan/shared";
import { CurrentSession, CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership, Roles } from "../auth/roles.decorator.js";
import { MeService } from "./me.service.js";

@Controller("me")
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  async getMe(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership?: Membership,
  ): Promise<MeResponse> {
    return this.meService.getMe(user.id, membership);
  }

  /** The caller's own devices (step 5.10a). User and current device come from the session only. */
  @Get("devices")
  @Roles("student")
  getMyDevices(@CurrentSession() session: AuthSession) {
    return this.meService.listDevices(session.userId, session.deviceId ?? null);
  }
}
