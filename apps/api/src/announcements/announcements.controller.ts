import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import type { Membership } from "@itqan/database";
import {
  CreateAnnouncementSchema,
  ListAnnouncementsQuerySchema,
  type AnnouncementDto,
  type ListAnnouncementsResponseDto,
} from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership, Roles } from "../auth/roles.decorator.js";
import { AnnouncementsService } from "./announcements.service.js";

@Controller("announcements")
export class AnnouncementsController {
  constructor(
    @Inject(AnnouncementsService) private readonly announcementsService: AnnouncementsService,
  ) {}

  @Post()
  @Roles("teacher", "assistant")
  @HttpCode(201)
  async create(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
    @Body() raw: unknown,
  ): Promise<AnnouncementDto> {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }

    const parsed = CreateAnnouncementSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid announcement payload.",
        errors: parsed.error.issues,
      });
    }

    return this.announcementsService.create(
      { userId: user.id, role: membership.role },
      parsed.data,
    );
  }

  @Get()
  @HttpCode(200)
  async list(
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
    @Query() raw: unknown,
  ): Promise<ListAnnouncementsResponseDto> {
    if (!membership) {
      throw new ForbiddenException("No tenant membership found");
    }

    const parsed = ListAnnouncementsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid announcements query parameters.",
        errors: parsed.error.issues,
      });
    }

    return this.announcementsService.list(
      { userId: user.id, role: membership.role },
      parsed.data,
    );
  }
}
