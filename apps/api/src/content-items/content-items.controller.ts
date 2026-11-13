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
  ContentItemCreateSchema,
  ContentItemPatchSchema,
  ContentTreeQuerySchema,
} from "@itqan/shared";
import type { Membership } from "@itqan/database";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { CurrentMembership, Roles } from "../auth/roles.decorator.js";
import { ContentAccessService } from "./content-access.service.js";
import { ContentItemsService } from "./content-items.service.js";

type Schema<T> = {
  safeParse(raw: unknown): { success: true; data: T } | { success: false };
};

function parse<T>(schema: Schema<T>, raw: unknown, reason = "INVALID_BODY"): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({ statusCode: 400, reason, message: "Invalid request." });
  }
  return parsed.data;
}

@Controller("content-items")
@Roles("teacher", "assistant")
export class ContentItemsController {
  constructor(
    @Inject(ContentItemsService) private readonly service: ContentItemsService,
    @Inject(ContentAccessService) private readonly access: ContentAccessService,
  ) {}

  /** Signed view/download links (step 7.6). Students get them only for content they may see. */
  @Get(":id/access")
  @Roles("teacher", "assistant", "student")
  getAccess(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
  ) {
    return this.access.access(id, user, membership?.role === "student");
  }

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    return this.service.create(parse(ContentItemCreateSchema, raw), user.id);
  }

  @Patch(":id")
  update(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() raw: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, parse(ContentItemPatchSchema, raw), user.id);
  }

  @Delete(":id")
  remove(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }

  @Post(":id/restore")
  @HttpCode(200)
  restore(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.restore(id, user.id);
  }
}

/** GET /courses/:id/tree: the full tree for staff (7.4), the published tree for students (7.6). */
@Controller("courses")
export class CourseTreeController {
  constructor(
    @Inject(ContentItemsService) private readonly service: ContentItemsService,
    @Inject(ContentAccessService) private readonly access: ContentAccessService,
  ) {}

  @Get(":id/tree")
  @Roles("teacher", "assistant", "student")
  tree(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() raw: unknown,
    @CurrentUser() user: AuthUser,
    @CurrentMembership() membership: Membership | undefined,
  ) {
    if (membership?.role === "student") return this.access.studentTree(id, user);
    const { deleted } = parse(ContentTreeQuerySchema, raw, "INVALID_QUERY");
    return this.service.tree(id, deleted === "true");
  }
}
