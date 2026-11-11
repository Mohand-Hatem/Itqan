import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthSession, AuthUser } from "@itqan/auth";
import type { Request } from "express";

/**
 * Parameter decorator to extract the authenticated user from the request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user;
  },
);

/**
 * Parameter decorator to extract the active session from the request.
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthSession | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.session;
  },
);
