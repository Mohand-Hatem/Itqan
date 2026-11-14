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
import { QuestionCreateSchema, QuestionQuerySchema, QuestionUpdateSchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { QuestionsService } from "./questions.service.js";

@Controller()
@Roles("teacher", "assistant")
export class QuestionsController {
  constructor(@Inject(QuestionsService) private readonly service: QuestionsService) {}

  @Post("question-banks/:bankId/questions")
  @HttpCode(201)
  create(
    @Param("bankId", new ParseUUIDPipe()) bankId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = QuestionCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid question payload",
      });
    }
    return this.service.create(bankId, parsed.data, user.id);
  }

  @Get("question-banks/:bankId/questions")
  listByBank(@Param("bankId", new ParseUUIDPipe()) bankId: string, @Query() raw: unknown) {
    const parsed = QuestionQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: parsed.error.issues[0]?.message ?? "Invalid query parameters",
      });
    }
    return this.service.listByBank(bankId, parsed.data);
  }

  @Get("questions/:id")
  getById(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.service.getById(id);
  }

  @Patch("questions/:id")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = QuestionUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid question update payload",
      });
    }
    return this.service.update(id, parsed.data, user.id);
  }

  @Delete("questions/:id")
  delete(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.delete(id, user.id);
  }
}
