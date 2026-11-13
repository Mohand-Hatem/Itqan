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
  Post,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { EnrollmentCreateSchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { EnrollmentsService } from "./enrollments.service.js";

@Controller("students/:membershipId/enrollments")
export class StudentEnrollmentsController {
  constructor(@Inject(EnrollmentsService) private readonly service: EnrollmentsService) {}

  @Post()
  @Roles("teacher", "assistant")
  @HttpCode(201)
  grant(
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = EnrollmentCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid enrollment payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.grant(membershipId, parsed.data.courseId, user.id);
  }
}

@Controller("enrollments")
export class EnrollmentsController {
  constructor(@Inject(EnrollmentsService) private readonly service: EnrollmentsService) {}

  @Delete(":id")
  @Roles("teacher") // Assistants receive 403 Forbidden automatically by AccessGuard; Super admins bypass AccessGuard
  @HttpCode(200)
  terminate(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.terminate(id, user.id, !!user.isSuperAdmin);
  }
}

@Controller("courses")
export class CourseAccessController {
  constructor(@Inject(EnrollmentsService) private readonly service: EnrollmentsService) {}

  @Get(":id/access")
  @Roles("student")
  @HttpCode(200)
  checkAccess(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.checkAccess(id, user);
  }
}
