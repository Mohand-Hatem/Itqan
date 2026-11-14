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
  QuizCreateSchema,
  QuizListQuerySchema,
  QuizReasonCode,
  QuizUpdateSchema,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { QuizzesService } from "./quizzes.service.js";

@Controller("quizzes")
@Roles("teacher", "assistant")
export class QuizzesController {
  constructor(@Inject(QuizzesService) private readonly service: QuizzesService) {}

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = QuizCreateSchema.safeParse(raw);
    if (!parsed.success) {
      const isTiming = parsed.error.issues.some((i) => i.path.includes("closesAt"));
      throw new BadRequestException({
        statusCode: 400,
        reason: isTiming ? QuizReasonCode.INVALID_TIMING_WINDOW : "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid quiz payload",
      });
    }
    return this.service.create(parsed.data, user.id);
  }

  @Get()
  list(@Query() raw: unknown) {
    const parsed = QuizListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: parsed.error.issues[0]?.message ?? "Invalid quiz query parameters",
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
    const parsed = QuizUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid quiz update payload",
      });
    }
    return this.service.update(id, parsed.data, user.id);
  }

  @Post(":id/publish")
  @HttpCode(200)
  publish(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.publish(id, user.id);
  }

  @Post(":id/unpublish")
  @HttpCode(200)
  unpublish(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.unpublish(id, user.id);
  }

  @Post(":id/release-grades")
  @HttpCode(200)
  releaseGrades(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.releaseGrades(id, user.id);
  }

  @Delete(":id")
  delete(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.delete(id, user.id);
  }
}
