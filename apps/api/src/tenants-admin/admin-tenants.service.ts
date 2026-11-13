import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Auth } from "@itqan/auth";
import { PrismaClient } from "@itqan/database";
import type {
  AdminTenantCreateDto,
  AdminTenantListItem,
  AdminTenantListQuery,
  AdminTenantListResponse,
  AdminTenantSoftDeleteResponse,
  AdminTenantUpdateDto,
  AdminUserUpdateDto,
  AdminUserUpdateResponse,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { AUTH_INSTANCE } from "../auth/session.guard.js";
import { TenantResolver } from "../tenancy/tenant-resolver.js";

@Injectable()
export class AdminTenantsService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantResolver) private readonly tenantResolver: TenantResolver,
  ) {}

  /** Provisions a new tenant with initial teacher credentials and warms resolver cache. */
  async create(actorUserId: string, dto: AdminTenantCreateDto): Promise<AdminTenantListItem> {
    const slug = dto.slug.trim().toLowerCase();
    const teacherEmail = dto.teacherEmail.trim().toLowerCase();
    const teacherName = dto.teacherName?.trim() || dto.name;

    // 1. Check duplicate slug
    const existingTenant = await this.db.tenant.findUnique({
      where: { slug },
    });
    if (existingTenant) {
      throw new ConflictException({
        statusCode: 409,
        code: "SLUG_ALREADY_EXISTS",
        message: `Tenant with slug '${slug}' already exists.`,
      });
    }

    return this.db.$transaction(async (tx) => {
      // 2. Create Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug,
          status: "active",
        },
      });

      // 3. User & Teacher Account
      const existingUser = await tx.user.findUnique({
        where: { email: teacherEmail },
      });

      let userId: string;
      let userRecord: { id: string; name: string; email: string };
      let existingUserLinked = false;

      if (existingUser) {
        userId = existingUser.id;
        userRecord = { id: existingUser.id, name: existingUser.name, email: existingUser.email };
        existingUserLinked = true;
      } else {
        const ctx = await this.auth.$context;
        const hashedPassword = await ctx.password.hash(dto.temporaryPassword);

        const newUser = await tx.user.create({
          data: {
            name: teacherName,
            email: teacherEmail,
            emailVerified: true,
          },
        });

        await tx.account.create({
          data: {
            userId: newUser.id,
            accountId: newUser.id,
            providerId: "credential",
            password: hashedPassword,
          },
        });

        userId = newUser.id;
        userRecord = { id: newUser.id, name: newUser.name, email: newUser.email };
      }

      // 4. Create primary teacher membership
      await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId,
          role: "teacher",
          status: "active",
        },
      });

      // 5. Transactional Audit Log
      await this.audit.record(
        {
          action: "tenant.create",
          targetType: "tenant",
          targetId: tenant.id,
          tenantId: tenant.id,
          actorUserId,
          meta: {
            slug: tenant.slug,
            name: tenant.name,
            teacherUserId: userId,
            existingUserLinked,
          },
        },
        tx,
      );

      // 6. Pre-populate tenant cache for instant host resolution
      this.tenantResolver.set(slug, { id: tenant.id, slug: tenant.slug });

      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        pausedRoles: tenant.pausedRoles,
        teacher: userRecord,
        usage: {
          studentCount: 0,
          courseCount: 0,
          storageBytes: 0,
        },
        createdAt: tenant.createdAt.toISOString(),
        existingUserLinked,
      };
    });
  }

  /** Lists tenants with cursor pagination and live usage metrics. */
  async list(query: AdminTenantListQuery): Promise<AdminTenantListResponse> {
    const limit = query.limit ?? 20;

    const tenants = await this.db.tenant.findMany({
      where: { deletedAt: null },
      take: limit + 1,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      orderBy: { createdAt: "desc" },
      include: {
        memberships: {
          where: { role: "teacher" },
          take: 1,
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    const hasNextPage = tenants.length > limit;
    const items = hasNextPage ? tenants.slice(0, limit) : tenants;
    const nextCursor = hasNextPage ? items[items.length - 1]!.id : null;
    const tenantIds = items.map((t) => t.id);

    // Batched metrics aggregation: 2 queries for entire list
    const [studentCounts, courseCounts] = await Promise.all([
      this.db.membership.groupBy({
        by: ["tenantId"],
        where: {
          tenantId: { in: tenantIds },
          role: "student",
          status: "active",
        },
        _count: { id: true },
      }),
      this.db.course.groupBy({
        by: ["tenantId"],
        where: {
          tenantId: { in: tenantIds },
          status: "published",
          deletedAt: null,
        },
        _count: { id: true },
      }),
    ]);

    const studentCountMap = new Map(studentCounts.map((s) => [s.tenantId, s._count.id]));
    const courseCountMap = new Map(courseCounts.map((c) => [c.tenantId, c._count.id]));

    return {
      items: items.map((t) => {
        const teacherMember = t.memberships[0];
        const teacher = teacherMember?.user ?? null;
        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          status: t.status,
          pausedRoles: t.pausedRoles,
          teacher: teacher ? { id: teacher.id, name: teacher.name, email: teacher.email } : null,
          usage: {
            studentCount: studentCountMap.get(t.id) ?? 0,
            courseCount: courseCountMap.get(t.id) ?? 0,
            storageBytes: 0,
          },
          createdAt: t.createdAt.toISOString(),
        };
      }),
      nextCursor,
    };
  }

  /** Retrieves single tenant details with live usage breakdown. */
  async getById(id: string): Promise<AdminTenantListItem> {
    const tenant = await this.db.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        memberships: {
          where: { role: "teacher" },
          take: 1,
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException({
        statusCode: 404,
        code: "TENANT_NOT_FOUND",
        message: "Tenant not found",
      });
    }

    const [studentCount, courseCount] = await Promise.all([
      this.db.membership.count({
        where: {
          tenantId: tenant.id,
          role: "student",
          status: "active",
        },
      }),
      this.db.course.count({
        where: {
          tenantId: tenant.id,
          status: "published",
          deletedAt: null,
        },
      }),
    ]);

    const teacherMember = tenant.memberships[0];
    const teacher = teacherMember?.user ?? null;

    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      pausedRoles: tenant.pausedRoles,
      teacher: teacher ? { id: teacher.id, name: teacher.name, email: teacher.email } : null,
      usage: {
        studentCount,
        courseCount,
        storageBytes: 0,
      },
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  /** Updates tenant name, slug, and/or pausedRoles with selective session eviction. */
  async update(
    actorUserId: string,
    id: string,
    dto: AdminTenantUpdateDto,
  ): Promise<AdminTenantListItem> {
    const currentTenant = await this.db.tenant.findFirst({
      where: { id, deletedAt: null },
    });

    if (!currentTenant) {
      throw new NotFoundException({
        statusCode: 404,
        code: "TENANT_NOT_FOUND",
        message: "Tenant not found",
      });
    }

    const newSlug = dto.slug ? dto.slug.trim().toLowerCase() : undefined;
    if (newSlug && newSlug !== currentTenant.slug) {
      const existing = await this.db.tenant.findUnique({
        where: { slug: newSlug },
      });
      if (existing) {
        throw new ConflictException({
          statusCode: 409,
          code: "SLUG_ALREADY_EXISTS",
          message: `Tenant with slug '${newSlug}' already exists.`,
        });
      }
    }

    const { updatedTenant } = await this.db.$transaction(async (tx) => {
      let evicted = 0;
      if (dto.pausedRoles) {
        const newlyPaused = dto.pausedRoles.filter((r) => !currentTenant.pausedRoles.includes(r));
        if (newlyPaused.length > 0) {
          const memberships = await tx.membership.findMany({
            where: { tenantId: id, role: { in: newlyPaused } },
            select: { userId: true },
          });
          const userIds = memberships.map((m) => m.userId);
          if (userIds.length > 0) {
            const delRes = await tx.session.deleteMany({
              where: {
                tenantId: id,
                userId: { in: userIds },
              },
            });
            evicted = delRes.count;
          }
        }
      }

      const updated = await tx.tenant.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          slug: newSlug,
          pausedRoles: dto.pausedRoles,
        },
        include: {
          memberships: {
            where: { role: "teacher" },
            take: 1,
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      });

      await this.audit.record(
        {
          action: "tenant.update",
          targetType: "tenant",
          targetId: id,
          tenantId: id,
          actorUserId,
          meta: {
            name: dto.name,
            slug: newSlug,
            pausedRoles: dto.pausedRoles,
            sessionsEvicted: evicted,
          },
        },
        tx,
      );

      return { updatedTenant: updated, sessionsEvicted: evicted };
    });

    // Invalidate/update cache if slug changed
    if (newSlug && newSlug !== currentTenant.slug) {
      this.tenantResolver.invalidate(currentTenant.slug);
      this.tenantResolver.set(newSlug, { id: updatedTenant.id, slug: updatedTenant.slug });
    }

    const [studentCount, courseCount] = await Promise.all([
      this.db.membership.count({
        where: {
          tenantId: updatedTenant.id,
          role: "student",
          status: "active",
        },
      }),
      this.db.course.count({
        where: {
          tenantId: updatedTenant.id,
          status: "published",
          deletedAt: null,
        },
      }),
    ]);

    const teacherMember = updatedTenant.memberships[0];
    const teacher = teacherMember?.user ?? null;

    return {
      id: updatedTenant.id,
      slug: updatedTenant.slug,
      name: updatedTenant.name,
      status: updatedTenant.status,
      pausedRoles: updatedTenant.pausedRoles,
      teacher: teacher ? { id: teacher.id, name: teacher.name, email: teacher.email } : null,
      usage: {
        studentCount,
        courseCount,
        storageBytes: 0,
      },
      createdAt: updatedTenant.createdAt.toISOString(),
    };
  }

  /** Soft-deletes a tenant, terminates all its sessions, and invalidates resolver cache. */
  async softDelete(actorUserId: string, id: string): Promise<AdminTenantSoftDeleteResponse> {
    const currentTenant = await this.db.tenant.findFirst({
      where: { id, deletedAt: null },
    });

    if (!currentTenant) {
      throw new NotFoundException({
        statusCode: 404,
        code: "TENANT_NOT_FOUND",
        message: "Tenant not found",
      });
    }

    const now = new Date();
    const { sessionsEvicted } = await this.db.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id },
        data: {
          status: "deleted",
          deletedAt: now,
        },
      });

      const members = await tx.membership.findMany({
        where: {
          tenantId: id,
          user: { isSuperAdmin: false },
        },
        select: { userId: true },
      });
      const memberUserIds = members.map((m) => m.userId);

      const delRes = await tx.session.deleteMany({
        where: {
          OR: [{ tenantId: id }, { userId: { in: memberUserIds } }],
        },
      });

      await this.audit.record(
        {
          action: "tenant.delete",
          targetType: "tenant",
          targetId: id,
          tenantId: id,
          actorUserId,
          meta: {
            slug: currentTenant.slug,
            deletedAt: now.toISOString(),
            sessionsEvicted: delRes.count,
          },
        },
        tx,
      );

      return { sessionsEvicted: delRes.count };
    });

    // Invalidate resolver cache so subsequent host requests get 404 immediately
    this.tenantResolver.invalidate(currentTenant.slug);

    return {
      id,
      status: "deleted",
      deletedAt: now.toISOString(),
      sessionsEvicted,
    };
  }

  /** Updates global user status (active / suspended) with global session termination. */
  async updateUserStatus(
    actorUserId: string,
    targetUserId: string,
    dto: AdminUserUpdateDto,
  ): Promise<AdminUserUpdateResponse> {
    if (actorUserId === targetUserId && dto.status === "suspended") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "CANNOT_SUSPEND_SELF",
        message: "Super admin cannot suspend their own account.",
      });
    }

    const user = await this.db.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { status: dto.status },
        select: { id: true, name: true, email: true, status: true },
      });

      let sessionsEvicted = 0;
      if (dto.status === "suspended") {
        const delRes = await tx.session.deleteMany({
          where: { userId: targetUserId },
        });
        sessionsEvicted = delRes.count;
      }

      await this.audit.record(
        {
          action: dto.status === "suspended" ? "user.suspend" : "user.reactivate",
          targetType: "user",
          targetId: targetUserId,
          tenantId: null,
          actorUserId,
          meta: {
            previousStatus: user.status,
            newStatus: dto.status,
            sessionsEvicted,
          },
        },
        tx,
      );

      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        status: updated.status,
        sessionsEvicted,
      };
    });
  }
}
