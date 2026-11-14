import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AuthUser } from "@itqan/auth";
import { getRequestContext, type Membership, type ScopedPrismaClient, systemPrisma } from "@itqan/database";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

@Injectable()
export class EnrollmentsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async grant(membershipId: string, courseId: string, actorUserId: string) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const targetMembership = await systemPrisma.membership.findFirst({
      where: { id: membershipId, tenantId },
    });
    if (!targetMembership) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "MEMBERSHIP_NOT_FOUND",
        message: "Student membership not found in this academy.",
      });
    }
    if (targetMembership.role !== "student") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_TARGET_ROLE",
        message: "Enrollments can only be granted to students.",
      });
    }

    const course = await systemPrisma.course.findFirst({
      where: { id: courseId, tenantId, deletedAt: null },
    });
    if (!course) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "COURSE_NOT_FOUND",
        message: "Course not found or no longer available.",
      });
    }

    const existing = await systemPrisma.enrollment.findUnique({
      where: {
        membershipId_courseId: {
          membershipId: targetMembership.id,
          courseId: course.id,
        },
      },
    });

    if (existing) {
      if (existing.status === "active") {
        throw new BadRequestException({
          statusCode: 400,
          reason: "ALREADY_ENROLLED",
          message: "The student is already actively enrolled in this course.",
        });
      }

      const reactivated = await systemPrisma.enrollment.update({
        where: { id: existing.id },
        data: {
          status: "active",
          source: "manual",
          grantedBy: actorUserId,
          terminatedAt: null,
          terminatedBy: null,
          updatedAt: new Date(),
        },
      });

      await this.audit.record({
        action: "enrollment.grant",
        tenantId,
        targetType: "enrollment",
        targetId: reactivated.id,
        actorUserId,
        meta: {
          membershipId: targetMembership.id,
          courseId: course.id,
          reactivated: true,
        },
      });

      return reactivated;
    }

    const created = await systemPrisma.enrollment.create({
      data: {
        tenantId,
        membershipId: targetMembership.id,
        courseId: course.id,
        status: "active",
        source: "manual",
        grantedBy: actorUserId,
      },
    });

    await this.audit.record({
      action: "enrollment.grant",
      tenantId,
      targetType: "enrollment",
      targetId: created.id,
      actorUserId,
      meta: {
        membershipId: targetMembership.id,
        courseId: course.id,
        reactivated: false,
      },
    });

    return created;
  }

  async terminate(enrollmentId: string, actorUserId: string, isSuperAdmin: boolean) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;

    const enrollment = await systemPrisma.enrollment.findUnique({
      where: { id: enrollmentId },
    });
    if (!enrollment) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "ENROLLMENT_NOT_FOUND",
        message: "Enrollment not found.",
      });
    }

    if (!isSuperAdmin && enrollment.tenantId !== tenantId) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "ENROLLMENT_NOT_FOUND",
        message: "Enrollment not found.",
      });
    }

    if (enrollment.status === "terminated") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "ENROLLMENT_ALREADY_TERMINATED",
        message: "This enrollment is already terminated.",
      });
    }

    const updated = await systemPrisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        status: "terminated",
        terminatedAt: new Date(),
        terminatedBy: actorUserId,
        updatedAt: new Date(),
      },
    });

    await this.audit.record({
      action: "enrollment.terminate",
      tenantId: enrollment.tenantId,
      targetType: "enrollment",
      targetId: updated.id,
      actorUserId,
      meta: {
        membershipId: enrollment.membershipId,
        courseId: enrollment.courseId,
      },
    });

    return updated;
  }

  async checkAccess(courseId: string, authUser: AuthUser, preloadedMembership?: Membership) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const course = await systemPrisma.course.findFirst({
      where: { id: courseId, tenantId, deletedAt: null },
    });
    if (!course) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
    }

    const membership =
      preloadedMembership ??
      (await systemPrisma.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId,
            userId: authUser.id,
          },
        },
      }));
    if (!membership || membership.status === "suspended") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "You do not have active access to this academy.",
      });
    }

    const enrollment = await systemPrisma.enrollment.findUnique({
      where: {
        membershipId_courseId: {
          membershipId: membership.id,
          courseId,
        },
      },
    });

    if (!enrollment) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "ENROLLMENT_REQUIRED",
        message: "You are not enrolled in this course.",
      });
    }

    if (enrollment.status === "terminated") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "ENROLLMENT_TERMINATED",
        message: "Your enrollment in this course has been terminated.",
      });
    }

    return {
      access: true,
      courseId,
      status: "active",
    };
  }
}
