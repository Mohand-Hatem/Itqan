import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import { AccessReasonCode, ProgressUpdateSchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership, Roles } from "../auth/roles.decorator.js";
import { ProgressService } from "./progress.service.js";

/**
 * The caller's student membership id. A super admin with no membership here passes @Roles, so
 * refuse explicitly: an undefined membershipId would mean "no filter" to Prisma.
 */
function studentMembershipId(membership: Membership | undefined): string {
  if (membership?.role !== "student") {
    throw new ForbiddenException({
      statusCode: 403,
      reason: AccessReasonCode.ROLE_FORBIDDEN,
      message: "Only students track progress.",
    });
  }
  return membership.id;
}

@Controller()
@Roles("student")
export class ProgressController {
  constructor(@Inject(ProgressService) private readonly service: ProgressService) {}

  @Put("progress/:itemId")
  save(
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
  ) {
    const membershipId = studentMembershipId(membership);
    const parsed = ProgressUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid progress payload.",
      });
    }
    return this.service.save(itemId, parsed.data, user, membershipId);
  }

  @Get("courses/:id/progress")
  forCourse(
    @Param("id", new ParseUUIDPipe()) courseId: string,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
  ) {
    return this.service.forCourse(courseId, user, studentMembershipId(membership));
  }
}
