import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import {
  AdminTenantCreateSchema,
  AdminTenantListQuerySchema,
  AdminTenantUpdateSchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SuperAdminOnly } from "../auth/roles.decorator.js";
import { AdminTenantsService } from "./admin-tenants.service.js";

@Controller("admin/tenants")
@SuperAdminOnly()
export class AdminTenantsController {
  constructor(@Inject(AdminTenantsService) private readonly service: AdminTenantsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = AdminTenantCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid tenant creation payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.create(user.id, parsed.data);
  }

  @Get()
  list(@Query() raw: unknown) {
    const parsed = AdminTenantListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
        errors: parsed.error.issues,
      });
    }
    return this.service.list(parsed.data);
  }

  @Get(":id")
  getById(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.getById(id);
  }

  @Patch(":id")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = AdminTenantUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid tenant update payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.update(user.id, id, parsed.data);
  }

  @Delete(":id")
  softDelete(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.softDelete(user.id, id);
  }
}
