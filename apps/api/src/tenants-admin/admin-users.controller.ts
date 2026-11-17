import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { AdminSetPasswordSchema, AdminUserUpdateSchema } from "@itqan/shared";
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

  /** POST /api/admin/users/:id/password (10R.3, FR-A07). */
  @Post(":id/password")
  @HttpCode(200)
  setPassword(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = AdminSetPasswordSchema.safeParse(raw);
    if (!parsed.success) {
      // Zod issues only: the rejected value itself is never echoed back.
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid password payload.",
        errors: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
      });
    }
    return this.service.setUserPassword(user.id, id, parsed.data.newPassword);
  }
}
