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
import { CourseCreateSchema, CoursePatchSchema, CourseQuerySchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { CoursesService } from "./courses.service.js";

@Controller("courses")
@Roles("teacher", "assistant")
export class CoursesController {
  constructor(@Inject(CoursesService) private readonly service: CoursesService) {}

  @Post()
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = CourseCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid course payload.",
      });
    }
    return this.service.create(parsed.data, user.id);
  }

  @Get()
  list(@Query() raw: unknown) {
    const parsed = CourseQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
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
    const parsed = CoursePatchSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid course patch payload.",
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
