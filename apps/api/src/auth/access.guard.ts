import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { getRequestContext, PrismaClient, type Role } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator.js";
import { ROLES_KEY, SUPER_ADMIN_ONLY_KEY } from "./roles.decorator.js";

@Injectable()
export class AccessGuard implements CanActivate {
  private readonly pausedRolesCache = new Map<string, { pausedRoles: Role[]; expiresAt: number }>();

  constructor(
    private readonly reflector: Reflector,
    @Inject(PrismaClient) private readonly db: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;

    if (!user) {
      throw new UnauthorizedException("Unauthorized");
    }

    // 1. User status check: suspended user is blocked globally
    if (user.status === "suspended") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AccessReasonCode.USER_SUSPENDED,
        message: "Your account is suspended.",
      });
    }

    // 2. Super admin only routes
    const superAdminOnly = this.reflector.getAllAndOverride<boolean>(
      SUPER_ADMIN_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (superAdminOnly) {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException({
          statusCode: 403,
          reason: AccessReasonCode.NO_ACCESS,
          message: "Super admin access required.",
        });
      }
      return true;
    }

    const reqContext = getRequestContext();

    // 3. Admin portal host check (admin.localhost)
    if (reqContext?.kind === "admin") {
      if (!user.isSuperAdmin) {
        throw new ForbiddenException({
          statusCode: 403,
          reason: AccessReasonCode.NO_ACCESS,
          message: "Super admin access required for admin portal.",
        });
      }
      return true;
    }

    // 4. Tenant host check (tenant-slug.localhost)
    if (reqContext?.kind === "tenant") {
      const tenantId = reqContext.tenantId;

      const membership = await this.db.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId,
            userId: user.id,
          },
        },
      });

      if (!membership || membership.status !== "active") {
        if (!user.isSuperAdmin) {
          throw new ForbiddenException({
            statusCode: 403,
            reason: AccessReasonCode.NO_ACCESS,
            message: "You do not have active access to this tenant.",
          });
        }
      }

      if (membership) {
        req.membership = membership;

        // Check if role is in tenant.paused_roles (cached 10s to prevent per-request DB stampede)
        let pausedRoles: Role[] = [];
        const cached = this.pausedRolesCache.get(tenantId);
        if (cached && cached.expiresAt > Date.now()) {
          pausedRoles = cached.pausedRoles;
        } else {
          const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: { pausedRoles: true },
          });
          pausedRoles = tenant?.pausedRoles ?? [];
          this.pausedRolesCache.set(tenantId, {
            pausedRoles,
            expiresAt: Date.now() + 10_000,
          });
        }

        if (pausedRoles.includes(membership.role)) {
          throw new ForbiddenException({
            statusCode: 403,
            reason: AccessReasonCode.TENANT_PAUSED,
            message: "This role is temporarily paused on this tenant.",
          });
        }

        // Role authorization check via @Roles(...)
        const requiredRoles = this.reflector.getAllAndOverride<Role[]>(
          ROLES_KEY,
          [context.getHandler(), context.getClass()],
        );

        if (requiredRoles && requiredRoles.length > 0) {
          if (!requiredRoles.includes(membership.role) && !user.isSuperAdmin) {
            throw new ForbiddenException({
              statusCode: 403,
              reason: AccessReasonCode.ROLE_FORBIDDEN,
              message: "Your role is not authorized for this resource.",
            });
          }
        }
      }

      return true;
    }

    return true;
  }
}
