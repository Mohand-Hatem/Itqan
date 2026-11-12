import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { readDeviceCookie, verifyDeviceSecret } from "@itqan/auth";
import { getRequestContext, PrismaClient } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "./public.decorator.js";

/**
 * Step 4 of the request pipeline (docs/03-system-design.md §3): a student's request must carry
 * the device cookie of the device the session was opened on, and that device must be active.
 * Runs after AccessGuard, which loads the membership. Never deletes the session: a rejected
 * request must not let someone sign the real student out.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PrismaClient) private readonly db: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (req.session?.deviceId) {
      // A session from student sign-in (password only, no TOTP) is valid only on the tenant it
      // was opened on, whatever role the user holds here. Otherwise it would open staff routes
      // on another tenant where the same user is staff (security audit, Phase 5).
      const ctx = getRequestContext();
      if (ctx?.kind !== "tenant" || ctx.tenantId !== req.session.tenantId) {
        throw new ForbiddenException({
          statusCode: 403,
          reason: AccessReasonCode.NO_ACCESS,
          message: "Please sign in on this site.",
        });
      }
    } else if (req.membership?.role !== "student" || req.user?.isSuperAdmin) {
      // Device rules apply to students only; staff and super admins have none.
      return true;
    }

    const presented = readDeviceCookie(req.headers.cookie);
    if (presented && presented.deviceId === req.session?.deviceId) {
      const device = await this.db.device.findUnique({
        where: { id: presented.deviceId },
        select: { userId: true, status: true, secretHash: true },
      });
      if (
        device?.userId === req.user?.id &&
        device?.status === "active" &&
        verifyDeviceSecret(presented.secret, device.secretHash)
      ) {
        return true;
      }
    }

    throw new ForbiddenException({
      statusCode: 403,
      reason: AccessReasonCode.DEVICE_NOT_REGISTERED,
      message: "This device is not registered for this account.",
    });
  }
}
