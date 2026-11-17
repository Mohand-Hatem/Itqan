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
  AdminMemberCreateSchema,
  AdminMemberListQuerySchema,
  AdminMemberUpdateSchema,
} from "@itqan/shared";
import type { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SuperAdminOnly } from "../auth/roles.decorator.js";
import { ProvisioningService } from "../provisioning/provisioning.service.js";
import { AdminMembersService } from "./admin-members.service.js";

/** Validates and never echoes rejected values (a body can carry a password). */
function parse<T extends z.ZodType>(schema: T, raw: unknown, reason: string): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      statusCode: 400,
      reason,
      message: "Invalid request.",
      errors: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
    });
  }
  return parsed.data;
}

/** Super admin management of a tenant's members (10R.4 create, 10R.5 list, change, remove). */
@Controller("admin/tenants/:tenantId/members")
@SuperAdminOnly()
export class AdminMembersController {
  constructor(
    @Inject(ProvisioningService) private readonly provisioning: ProvisioningService,
    @Inject(AdminMembersService) private readonly members: AdminMembersService,
  ) {}

  /** GET: teachers and assistants by default; `?role=student` or a comma list for others. */
  @Get()
  list(@Param("tenantId", new ParseUUIDPipe()) tenantId: string, @Query() raw: unknown) {
    return this.members.list(tenantId, parse(AdminMemberListQuerySchema, raw, "INVALID_QUERY"));
  }

  /**
   * POST (FR-E08): create any role directly, or link an existing account without touching its
   * password, profile or other memberships (D3). Audited.
   */
  @Post()
  @HttpCode(201)
  create(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.provisioning.provision({
      tenantId,
      actor: { userId: user.id, isSuperAdmin: true },
      ...parse(AdminMemberCreateSchema, raw, "INVALID_BODY"),
    });
  }

  /** PATCH: teacher ⇄ assistant, active ⇄ suspended; 409 LAST_TEACHER keeps one teacher. */
  @Patch(":membershipId")
  update(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const dto = parse(AdminMemberUpdateSchema, raw, "INVALID_BODY");
    return this.members.update(user.id, tenantId, membershipId, dto);
  }

  /** DELETE: remove a teacher or assistant; 409 LAST_TEACHER keeps one teacher. */
  @Delete(":membershipId")
  remove(
    @Param("tenantId", new ParseUUIDPipe()) tenantId: string,
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.members.remove(user.id, tenantId, membershipId);
  }
}
