import { Controller, Get } from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import type { MeResponse } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership } from "../auth/roles.decorator.js";
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
}
