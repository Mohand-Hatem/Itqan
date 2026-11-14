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
  QuestionBankCreateSchema,
  QuestionBankQuerySchema,
  QuestionBankUpdateSchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { QuestionBanksService } from "./question-banks.service.js";

@Controller("question-banks")
@Roles("teacher", "assistant")
export class QuestionBanksController {
  constructor(@Inject(QuestionBanksService) private readonly service: QuestionBanksService) {}

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = QuestionBankCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid question bank payload",
      });
    }
    return this.service.create(parsed.data, user.id);
  }

  @Get()
  list(@Query() raw: unknown) {
    const parsed = QuestionBankQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: parsed.error.issues[0]?.message ?? "Invalid query parameters",
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
    const parsed = QuestionBankUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid question bank update payload",
      });
    }
    return this.service.update(id, parsed.data, user.id);
  }

  @Delete(":id")
  @Roles("teacher")
  delete(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.delete(id, user.id);
  }
}
