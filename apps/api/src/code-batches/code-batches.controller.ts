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
import {
  CodeBatchCodesQuerySchema,
  CodeBatchCreateSchema,
  CodeBatchListQuerySchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { CodeBatchesService } from "./code-batches.service.js";

@Controller("code-batches")
export class CodeBatchesController {
  constructor(@Inject(CodeBatchesService) private readonly service: CodeBatchesService) {}

  @Post()
  @Roles("teacher")
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = CodeBatchCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid code batch payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.create(parsed.data, user.id);
  }

  @Get()
  @Roles("teacher", "assistant")
  list(@Query() raw: unknown) {
    const parsed = CodeBatchListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
      });
    }
    return this.service.list(parsed.data);
  }

  @Get(":id/codes")
  @Roles("teacher", "assistant")
  listCodes(@Param("id", new ParseUUIDPipe()) id: string, @Query() raw: unknown) {
    const parsed = CodeBatchCodesQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
      });
    }
    return this.service.listCodes(id, parsed.data);
  }

  @Post(":id/revoke")
  @Roles("teacher")
  @HttpCode(200)
  revoke(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.revoke(id, user.id);
  }
}
