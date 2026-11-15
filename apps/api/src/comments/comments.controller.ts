import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import {
  CreateCommentSchema,
  ListCommentsQuerySchema,
  UpdateCommentSchema,
  type CommentItemDto,
  type ListCommentsResponseDto,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership } from "../auth/roles.decorator.js";
import { CommentsService } from "./comments.service.js";

@Controller()
export class CommentsController {
  constructor(@Inject(CommentsService) private readonly commentsService: CommentsService) {}

  @Post("content-items/:id/comments")
  @HttpCode(201)
  async create(
    @Param("id") contentItemId: string,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
    @Body() raw: unknown,
  ): Promise<CommentItemDto> {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }

    const parsed = CreateCommentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid comment payload.",
        errors: parsed.error.issues,
      });
    }

    return this.commentsService.create(
      { userId: user.id, role: membership.role, membershipId: membership.id, user },
      contentItemId,
      parsed.data,
    );
  }

  @Get("content-items/:id/comments")
  @HttpCode(200)
  async list(
    @Param("id") contentItemId: string,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
    @Query() raw: unknown,
  ): Promise<ListCommentsResponseDto> {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }

    const parsed = ListCommentsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid comments query parameters.",
        errors: parsed.error.issues,
      });
    }

    return this.commentsService.list(
      { userId: user.id, role: membership.role, membershipId: membership.id, user },
      contentItemId,
      parsed.data,
    );
  }

  @Patch("comments/:id")
  @HttpCode(200)
  async update(
    @Param("id") commentId: string,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
    @Body() raw: unknown,
  ): Promise<CommentItemDto> {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }

    const parsed = UpdateCommentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid comment update payload.",
        errors: parsed.error.issues,
      });
    }

    return this.commentsService.update(
      { userId: user.id, role: membership.role, membershipId: membership.id, user },
      commentId,
      parsed.data,
    );
  }

  @Delete("comments/:id")
  @HttpCode(200)
  async delete(
    @Param("id") commentId: string,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
  ): Promise<{ success: boolean }> {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }

    return this.commentsService.delete(
      { userId: user.id, role: membership.role, membershipId: membership.id, user },
      commentId,
    );
  }
}
