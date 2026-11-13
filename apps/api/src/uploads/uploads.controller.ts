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
import { UploadCreateSchema, UploadPatchSchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { UploadsService } from "./uploads.service.js";

@Controller("uploads")
@Roles("teacher", "assistant")
export class UploadsController {
  constructor(@Inject(UploadsService) private readonly service: UploadsService) {}

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = UploadCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid upload payload.",
      });
    }
    return this.service.create(parsed.data, user.id);
  }

  @Patch(":id")
  setDownloadPolicy(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = UploadPatchSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid upload patch payload.",
      });
    }
    return this.service.setDownloadPolicy(id, parsed.data, user.id);
  }

  @Post(":id/confirm")
  @HttpCode(200)
  confirm(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.confirm(id, user.id);
  }
}
