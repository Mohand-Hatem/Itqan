import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Auth, AuthUser } from "@itqan/auth";
import { getRequestContext, type ScopedPrismaClient, systemPrisma } from "@itqan/database";
import { AccessReasonCode, type CodeRedeemInput, type CodeRegisterInput } from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { AUTH_INSTANCE } from "../auth/session.guard.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { hashAccessCode, normalizeAccessCode } from "./crypto.js";
import { defaultMaxDevices } from "../settings/default-max-devices.js";

@Injectable()
export class CodeRedemptionService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
  ) {}

  async registerWithCode(input: CodeRegisterInput) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const normalized = normalizeAccessCode(input.code);
    const codeHash = hashAccessCode(normalized);

    const code = await systemPrisma.accessCode.findUnique({
      where: { codeHash },
      include: {
        batch: true,
        course: true,
      },
    });

    if (!code || code.tenantId !== tenantId) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "CODE_NOT_FOUND",
        message: "Invalid access code.",
      });
    }

    if (code.revokedAt || code.batch.revokedAt) {
      throw new ConflictException({
        statusCode: 409,
        reason: "CODE_NOT_AVAILABLE",
        message: "This access code is invalid, expired, revoked, or has already been used.",
      });
    }

    if (code.redeemedAt) {
      throw new ConflictException({
        statusCode: 409,
        reason: "CODE_NOT_AVAILABLE",
        message: "This access code is invalid, expired, revoked, or has already been used.",
      });
    }

    if (code.course.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "COURSE_NOT_FOUND",
        message: "The associated course was deleted or is no longer available.",
      });
    }

    const email = input.email.toLowerCase().trim();
    const existingUser = await systemPrisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      throw new ConflictException({
        statusCode: 409,
        reason: "USER_ALREADY_EXISTS",
        message:
          "An account with this email already exists. Please sign in to redeem the access code.",
      });
    }

    const result = await systemPrisma.$transaction(async (tx) => {
      // Single-statement atomic conditional claim
      const claimed = await tx.accessCode.updateMany({
        where: {
          id: code.id,
          redeemedAt: null,
          revokedAt: null,
        },
        data: {
          redeemedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          reason: "CODE_NOT_AVAILABLE",
          message: "This access code is invalid, expired, revoked, or has already been used.",
        });
      }

      // Concurrency check for email collision
      const txUser = await tx.user.findUnique({
        where: { email },
      });
      if (txUser) {
        throw new ConflictException({
          statusCode: 409,
          reason: "USER_ALREADY_EXISTS",
          message:
            "An account with this email already exists. Please sign in to redeem the access code.",
        });
      }

      const ctx = await this.auth.$context;
      const passwordHash = await ctx.password.hash(input.password);

      const user = await tx.user.create({
        data: {
          email,
          name: input.name,
          emailVerified: false,
          status: "active",
          maxDevices: await defaultMaxDevices(tx, code.tenantId),
        },
      });

      await tx.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password: passwordHash,
        },
      });

      await tx.accessCode.update({
        where: { id: code.id },
        data: { redeemedBy: user.id },
      });

      await tx.accessCodeBatch.update({
        where: { id: code.batchId },
        data: { redeemedCount: { increment: 1 } },
      });

      const membership = await tx.membership.create({
        data: {
          tenantId: code.tenantId,
          userId: user.id,
          role: "student",
          phone: input.phone ?? null,
          guardianConsentAt: input.guardianConsent ? new Date() : null,
        },
      });

      await tx.enrollment.create({
        data: {
          tenantId: code.tenantId,
          membershipId: membership.id,
          courseId: code.courseId,
          source: "code",
          grantedBy: code.batch.createdById,
        },
      });

      await this.audit.record(
        {
          action: "code.register",
          tenantId: code.tenantId,
          targetType: "access_code",
          targetId: code.id,
          actorUserId: user.id,
          meta: {
            courseId: code.courseId,
            batchId: code.batchId,
            membershipId: membership.id,
          },
        },
        tx,
      );

      return {
        userId: user.id,
        membershipId: membership.id,
        courseId: code.courseId,
        email: user.email,
      };
    });

    try {
      await this.auth.api.sendVerificationEmail({
        body: { email: result.email },
      });
    } catch {
      // The account is created; the student can ask for the verification email again.
      // Never send a link with a made-up token (security audit, Phase 6).
    }

    return result;
  }

  async redeem(input: CodeRedeemInput, authUser: AuthUser) {
    if (authUser.status === "suspended") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AccessReasonCode.USER_SUSPENDED,
        message: "Your account is suspended.",
      });
    }

    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const normalized = normalizeAccessCode(input.code);
    const codeHash = hashAccessCode(normalized);

    const code = await systemPrisma.accessCode.findUnique({
      where: { codeHash },
      include: {
        batch: true,
        course: true,
      },
    });

    if (!code || code.tenantId !== tenantId) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "CODE_NOT_FOUND",
        message: "Invalid access code.",
      });
    }

    if (code.revokedAt || code.batch.revokedAt) {
      throw new ConflictException({
        statusCode: 409,
        reason: "CODE_NOT_AVAILABLE",
        message: "This access code is invalid, expired, revoked, or has already been used.",
      });
    }

    if (code.redeemedAt) {
      throw new ConflictException({
        statusCode: 409,
        reason: "CODE_NOT_AVAILABLE",
        message: "This access code is invalid, expired, revoked, or has already been used.",
      });
    }

    if (code.course.deletedAt) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "COURSE_NOT_FOUND",
        message: "The associated course was deleted or is no longer available.",
      });
    }

    const existingMembership = await systemPrisma.membership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: code.tenantId,
          userId: authUser.id,
        },
      },
    });

    if (existingMembership) {
      if (existingMembership.status === "suspended") {
        throw new ForbiddenException({
          statusCode: 403,
          reason: "MEMBERSHIP_SUSPENDED",
          message: "Your membership on this academy is suspended.",
        });
      }
      if (existingMembership.role !== "student") {
        throw new ForbiddenException({
          statusCode: 403,
          reason: "ROLE_FORBIDDEN",
          message: "Staff members cannot redeem student course codes.",
        });
      }

      const existingEnrollment = await systemPrisma.enrollment.findUnique({
        where: {
          membershipId_courseId: {
            membershipId: existingMembership.id,
            courseId: code.courseId,
          },
        },
      });

      if (existingEnrollment && existingEnrollment.status === "active") {
        throw new BadRequestException({
          statusCode: 400,
          reason: "ALREADY_ENROLLED",
          message: "You are already actively enrolled in this course.",
        });
      }
    }

    return systemPrisma.$transaction(async (tx) => {
      // Single-statement atomic conditional claim
      const claimed = await tx.accessCode.updateMany({
        where: {
          id: code.id,
          redeemedAt: null,
          revokedAt: null,
        },
        data: {
          redeemedAt: new Date(),
          redeemedBy: authUser.id,
        },
      });

      if (claimed.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          reason: "CODE_NOT_AVAILABLE",
          message: "This access code is invalid, expired, revoked, or has already been used.",
        });
      }

      await tx.accessCodeBatch.update({
        where: { id: code.batchId },
        data: { redeemedCount: { increment: 1 } },
      });

      let membership = await tx.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: code.tenantId,
            userId: authUser.id,
          },
        },
      });

      if (!membership) {
        membership = await tx.membership.create({
          data: {
            tenantId: code.tenantId,
            userId: authUser.id,
            role: "student",
          },
        });
      }

      const existingEnrollment = await tx.enrollment.findUnique({
        where: {
          membershipId_courseId: {
            membershipId: membership.id,
            courseId: code.courseId,
          },
        },
      });

      if (existingEnrollment) {
        if (existingEnrollment.status === "active") {
          throw new BadRequestException({
            statusCode: 400,
            reason: "ALREADY_ENROLLED",
            message: "You are already actively enrolled in this course.",
          });
        }

        await tx.enrollment.update({
          where: { id: existingEnrollment.id },
          data: {
            status: "active",
            source: "code",
            grantedBy: code.batch.createdById,
            updatedAt: new Date(),
          },
        });
      } else {
        await tx.enrollment.create({
          data: {
            tenantId: code.tenantId,
            membershipId: membership.id,
            courseId: code.courseId,
            source: "code",
            grantedBy: code.batch.createdById,
          },
        });
      }

      await this.audit.record(
        {
          action: "code.redeem",
          tenantId: code.tenantId,
          targetType: "access_code",
          targetId: code.id,
          actorUserId: authUser.id,
          meta: {
            courseId: code.courseId,
            batchId: code.batchId,
            membershipId: membership.id,
          },
        },
        tx,
      );

      return {
        membershipId: membership.id,
        courseId: code.courseId,
        courseTitle: code.course.title,
        status: "active",
      };
    });
  }
}
