import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import { StudentListQuerySchema } from "@itqan/shared";
import { Roles } from "../auth/roles.decorator.js";
import { StudentsService } from "./students.service.js";

@Controller("students")
@Roles("teacher", "assistant")
export class StudentsController {
  constructor(@Inject(StudentsService) private readonly service: StudentsService) {}

  @Get()
  list(@Query() raw: unknown) {
    const parsed = StudentListQuerySchema.safeParse(raw);
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

  @Get(":membershipId")
  getById(@Param("membershipId", new ParseUUIDPipe()) membershipId: string) {
    return this.service.getById(membershipId);
  }
}
