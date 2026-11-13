import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { AdminUserUpdateSchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SuperAdminOnly } from "../auth/roles.decorator.js";
import { AdminTenantsService } from "./admin-tenants.service.js";

@Controller("admin/users")
@SuperAdminOnly()
export class AdminUsersController {
  constructor(@Inject(AdminTenantsService) private readonly service: AdminTenantsService) {}

  @Patch(":id")
  updateStatus(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = AdminUserUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid user update payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.updateUserStatus(user.id, id, parsed.data);
  }
}
