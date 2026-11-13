import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { CodeRedeemSchema, CodeRegisterSchema } from "@itqan/shared";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Public } from "../auth/public.decorator.js";
import { CodeRedemptionService } from "./code-redemption.service.js";

@Controller("register-with-code")
export class RegisterWithCodeController {
  constructor(@Inject(CodeRedemptionService) private readonly service: CodeRedemptionService) {}

  @Post()
  @Public()
  @HttpCode(201)
  register(@Body() raw: unknown, @Headers("host") host: string = "localhost") {
    const parsed = CodeRegisterSchema.safeParse(raw);
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path.includes("guardianConsent"))) {
        throw new BadRequestException({
          statusCode: 400,
          reason: "GUARDIAN_CONSENT_REQUIRED",
          message: "Guardian consent is required for students under 18.",
        });
      }
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid registration payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.registerWithCode(parsed.data, host);
  }
}

@Controller("codes")
export class CodesController {
  constructor(@Inject(CodeRedemptionService) private readonly service: CodeRedemptionService) {}

  @Post("redeem")
  @Public()
  @HttpCode(200)
  redeem(@CurrentUser() user: AuthUser | undefined, @Body() raw: unknown) {
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        reason: "UNAUTHORIZED",
        message: "You must be signed in to redeem an access code.",
      });
    }

    const parsed = CodeRedeemSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "Invalid code redemption payload.",
        errors: parsed.error.issues,
      });
    }
    return this.service.redeem(parsed.data, user);
  }
}
