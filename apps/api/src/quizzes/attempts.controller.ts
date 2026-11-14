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
  Put,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { AuthSession, AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import {
  AttemptExtendTimeSchema,
  AttemptMoveDeviceSchema,
  SaveAttemptAnswerSchema,
  type AttemptAnswersResponseDto,
  type AttemptExtendTimeResponseDto,
  type AttemptMoveDeviceResponseDto,
  type AttemptResponseDto,
  type AttemptReviewResponseDto,
  type AttemptSubmitResponseDto,
  type SavedAttemptAnswerDto,
} from "@itqan/shared";
import { CurrentSession, CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership, Roles } from "../auth/roles.decorator.js";
import { AttemptsService } from "./attempts.service.js";

@Controller()
@Roles("student")
export class AttemptsController {
  constructor(@Inject(AttemptsService) private readonly service: AttemptsService) {}

  @Post("quizzes/:id/attempts")
  async startOrResume(
    @Param("id", new ParseUUIDPipe()) quizId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession,
    @CurrentMembership() membership: Membership,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AttemptResponseDto> {
    const result = await this.service.startOrResume(quizId, user, session, membership);
    res.status(result.resumed ? 200 : 201);
    return result.dto;
  }

  @Get("attempts/:id")
  async getAttempt(
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession,
    @CurrentMembership() membership: Membership,
  ): Promise<AttemptResponseDto> {
    return this.service.getAttempt(attemptId, user, session, membership);
  }

  @Put("attempts/:id/answers/:questionId")
  async saveAnswer(
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @Param("questionId", new ParseUUIDPipe()) questionId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession,
    @CurrentMembership() membership: Membership,
  ): Promise<SavedAttemptAnswerDto> {
    const parsed = SaveAttemptAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid answer payload",
      });
    }
    return this.service.saveAnswer(attemptId, questionId, parsed.data, user, session, membership);
  }

  @Get("attempts/:id/answers")
  async getAnswers(
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession,
    @CurrentMembership() membership: Membership,
  ): Promise<AttemptAnswersResponseDto> {
    return this.service.getAnswers(attemptId, user, session, membership);
  }

  @Post("attempts/:id/submit")
  @HttpCode(200)
  async submit(
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession,
    @CurrentMembership() membership: Membership,
  ): Promise<AttemptSubmitResponseDto> {
    return this.service.submit(attemptId, user, session, membership);
  }

  @Get("attempts/:id/review")
  @Roles("student", "teacher", "assistant")
  async getReview(
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @CurrentUser() user: AuthUser,
    @CurrentSession() session: AuthSession,
    @CurrentMembership() membership: Membership,
  ): Promise<AttemptReviewResponseDto> {
    return this.service.getReview(attemptId, user, session, membership);
  }

  @Post(["attempts/:id/extend", "attempts/:id/extend-time"])
  @Roles("teacher", "assistant")
  @HttpCode(200)
  async extendTime(
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership,
  ): Promise<AttemptExtendTimeResponseDto> {
    const parsed = AttemptExtendTimeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid extend-time payload",
      });
    }
    return this.service.extendTime(attemptId, parsed.data, user, membership);
  }

  @Post(["attempts/:id/move-device", "attempts/:id/transfer-device"])
  @Roles("teacher", "assistant")
  @HttpCode(200)
  async moveDevice(
    @Param("id", new ParseUUIDPipe()) attemptId: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership,
  ): Promise<AttemptMoveDeviceResponseDto> {
    const parsed = AttemptMoveDeviceSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: parsed.error.issues[0]?.message ?? "Invalid move-device payload",
      });
    }
    return this.service.moveDevice(attemptId, parsed.data, user, membership);
  }
}
