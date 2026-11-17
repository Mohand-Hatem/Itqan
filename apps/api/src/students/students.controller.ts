import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { getRequestContext, type Membership } from "@itqan/database";
import { StudentCreateSchema, StudentListQuerySchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership, Roles } from "../auth/roles.decorator.js";
import { ProvisioningService } from "../provisioning/provisioning.service.js";
import { StudentsService } from "./students.service.js";

@Controller("students")
@Roles("teacher", "assistant")
export class StudentsController {
  constructor(
    @Inject(StudentsService) private readonly service: StudentsService,
    @Inject(ProvisioningService) private readonly provisioning: ProvisioningService,
  ) {}

  /**
   * POST /api/students (10R.4, FR-E08): a teacher or assistant creates a student account directly.
   * Active at once, email unverified, no email sent; the password is never echoed back.
   */
  @Post()
  @HttpCode(201)
  create(
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership?: Membership,
  ) {
    const parsed = StudentCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid student payload.",
        errors: parsed.error.issues.map(({ path, message, code }) => ({ path, message, code })),
      });
    }
    const context = getRequestContext();
    if (context?.kind !== "tenant") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Open this on the academy's address.",
      });
    }
    return this.provisioning.provision({
      tenantId: context.tenantId,
      actor: { userId: user.id, isSuperAdmin: Boolean(user.isSuperAdmin), role: membership?.role },
      role: "student",
      ...parsed.data,
    });
  }

  @Get()
  list(@Query() raw: unknown) {
    const parsed = StudentListQuerySchema.safeParse(raw);
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

  @Get(":membershipId")
  getById(@Param("membershipId", new ParseUUIDPipe()) membershipId: string, @CurrentUser() user: AuthUser) {
    return this.service.getById(membershipId, Boolean(user.isSuperAdmin));
  }
}
