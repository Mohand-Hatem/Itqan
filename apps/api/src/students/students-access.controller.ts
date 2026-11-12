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
  Req,
} from "@nestjs/common";
import { StudentAccessPatchSchema } from "@itqan/shared";
import type { Request } from "express";
import { Roles } from "../auth/roles.decorator.js";
import { StudentsAccessService } from "./students-access.service.js";

// Staff actions on a student's access (docs/05 §7, step 5.9). Super admins pass the role check too.

@Controller("devices")
@Roles("teacher", "assistant")
export class DevicesController {
  constructor(@Inject(StudentsAccessService) private readonly service: StudentsAccessService) {}

  @Post(":id/revoke")
  @HttpCode(200)
  revoke(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: Request) {
    return this.service.revokeDevice(id, req.user!.id);
  }
}

@Controller("students")
@Roles("teacher", "assistant")
export class StudentsAccessController {
  constructor(@Inject(StudentsAccessService) private readonly service: StudentsAccessService) {}

  @Post(":membershipId/force-signout")
  @HttpCode(200)
  forceSignOut(
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @Req() req: Request,
  ) {
    return this.service.forceSignOut(membershipId, req.user!.id);
  }

  @Patch(":membershipId")
  update(
    @Param("membershipId", new ParseUUIDPipe()) membershipId: string,
    @Body() raw: unknown,
    @Req() req: Request,
  ) {
    const parsed = StudentAccessPatchSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid request.",
      });
    }
    return this.service.update(membershipId, parsed.data, {
      userId: req.user!.id,
      // FR-D02: max_devices is changed by the teacher or the super admin, not assistants.
      mayChangeMaxDevices: req.membership?.role === "teacher" || req.user?.isSuperAdmin === true,
    });
  }
}
