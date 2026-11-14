import { BadRequestException, Controller, Get, HttpCode, Inject, Query } from "@nestjs/common";
import { AuditLogListQuerySchema, type AuditLogListResponseDto } from "@itqan/shared";
import { Roles } from "../auth/roles.decorator.js";
import { AuditService } from "./audit.service.js";

/** Audit logs API (FR-A01, step 9.10a). Restricted to teachers and super admins. */
@Controller("audit-logs")
@Roles("teacher")
export class AuditController {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  @Get()
  @HttpCode(200)
  list(@Query() raw: unknown): Promise<AuditLogListResponseDto> {
    const parsed = AuditLogListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
      });
    }
    return this.auditService.list(parsed.data);
  }
}
