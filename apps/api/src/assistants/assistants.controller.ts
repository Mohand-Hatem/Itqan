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
  Post,
  Query,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { AssistantCreateSchema, AssistantListQuerySchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { AssistantsService } from "./assistants.service.js";

@Controller("assistants")
export class AssistantsController {
  constructor(@Inject(AssistantsService) private readonly service: AssistantsService) {}

  @Post()
  @Roles("teacher")
  @HttpCode(201)
  create(@Body() raw: unknown, @CurrentUser() user: AuthUser) {
    const parsed = AssistantCreateSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid assistant payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.create(user.id, parsed.data);
  }

  @Get()
  @Roles("teacher")
  list(@Query() raw: unknown) {
    const parsed = AssistantListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_QUERY",
        message: "Invalid query parameters.",
        errors: parsed.error.issues,
      });
    }
    return this.service.list(parsed.data);
  }

  @Delete(":id")
  @Roles("teacher")
  delete(@Param("id", new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.service.delete(user.id, id);
  }
}
