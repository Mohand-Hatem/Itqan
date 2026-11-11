import {
  createParamDecorator,
  type CustomDecorator,
  type ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { Membership, Role } from "@itqan/database";
import type { Request } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      membership?: Membership;
    }
  }
}

export const ROLES_KEY = "roles";
export const SUPER_ADMIN_ONLY_KEY = "superAdminOnly";

/**
 * Decorator to require one of the specified tenant roles.
 */
export const Roles = (...roles: Role[]): CustomDecorator =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Decorator to require platform super admin status.
 */
export const SuperAdminOnly = (): CustomDecorator =>
  SetMetadata(SUPER_ADMIN_ONLY_KEY, true);

/**
 * Parameter decorator to extract the resolved tenant membership from the request.
 */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Membership | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.membership;
  },
);
