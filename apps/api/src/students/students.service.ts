import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, systemPrisma } from "@itqan/database";
import type { StudentListQueryInput } from "@itqan/shared";

@Injectable()
export class StudentsService {
  async list(query: StudentListQueryInput) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const where: Record<string, unknown> = {
      tenantId,
      role: "student",
    };

    if (query.status && query.status !== "all") {
      where.status = query.status;
    }

    if (query.courseId) {
      where.enrollments = {
        some: {
          courseId: query.courseId,
        },
      };
    }

    if (query.q) {
      const search = query.q.trim();
      where.OR = [
        { user: { name: { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { phone: { contains: search, mode: "insensitive" } },
      ];
    }

    const rows = await systemPrisma.membership.findMany({
      where,
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            maxDevices: true,
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    const page = rows.slice(0, query.limit);
    const items = page.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      phone: m.phone,
      status: m.status,
      maxDevices: m.user.maxDevices,
      guardianConsentAt: m.guardianConsentAt,
      createdAt: m.createdAt,
      enrolledCoursesCount: m._count.enrollments,
    }));

    return {
      items,
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  async getById(membershipId: string) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const membership = await systemPrisma.membership.findFirst({
      where: {
        id: membershipId,
        tenantId,
        role: "student",
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            emailVerified: true,
            maxDevices: true,
          },
        },
        enrollments: {
          include: {
            course: {
              select: {
                id: true,
                title: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "STUDENT_NOT_FOUND",
        message: "Student not found in this academy.",
      });
    }

    const devices = await systemPrisma.device.findMany({
      where: { userId: membership.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    });

    const sessions = await systemPrisma.session.findMany({
      where: {
        userId: membership.user.id,
        tenantId,
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deviceId: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return {
      profile: {
        membershipId: membership.id,
        userId: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        emailVerified: membership.user.emailVerified,
        phone: membership.phone,
        status: membership.status,
        maxDevices: membership.user.maxDevices,
        guardianConsentAt: membership.guardianConsentAt,
        createdAt: membership.createdAt,
      },
      courses: membership.enrollments.map((e) => ({
        enrollmentId: e.id,
        courseId: e.course.id,
        title: e.course.title,
        status: e.status,
        source: e.source,
        enrolledAt: e.createdAt,
        terminatedAt: e.terminatedAt,
      })),
      devices,
      sessions,
      grades: [],
      payments: [],
    };
  }
}
