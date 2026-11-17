import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Auth, requiredPasswordLength } from "@itqan/auth";
import { PrismaClient } from "@itqan/database";
import { AccessReasonCode, PASSWORD_TOO_SHORT } from "@itqan/shared";
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
import { ProvisioningService } from "../provisioning/provisioning.service.js";
import { TenantResolver } from "../tenancy/tenant-resolver.js";
import { assertTeacherRemains } from "./last-teacher.js";

@Injectable()
export class AdminTenantsService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TenantResolver) private readonly tenantResolver: TenantResolver,
    @Inject(ProvisioningService) private readonly provisioning: ProvisioningService,
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
        reason: "SLUG_ALREADY_EXISTS",
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

      // 3–4. First teacher through the shared provisioning rules (10R.4, ADR-013): a new account is
      // active, unverified and changes its password at first sign-in; an existing one is linked.
      const teacher = await this.provisioning.provisionIn(tx, {
        tenantId: tenant.id,
        actor: { userId: actorUserId, isSuperAdmin: true },
        role: "teacher",
        email: teacherEmail,
        name: teacherName,
        password: dto.temporaryPassword,
      });
      const userId = teacher.userId;
      const existingUserLinked = teacher.existingUserLinked;
      const userRecord = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true },
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
        teachers: [{ ...userRecord, status: "active" as const }],
        assistantCount: 0,
        studentCount: 0,
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

    const tenants = await this.db.tenant
      .findMany({
        where: { deletedAt: null },
        take: limit + 1,
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
          throw new BadRequestException({
            statusCode: 400,
            reason: "INVALID_CURSOR",
            code: "INVALID_CURSOR",
            message: "Cursor record not found.",
          });
        }
        throw err;
      });

    const hasNextPage = tenants.length > limit;
    const items = hasNextPage ? tenants.slice(0, limit) : tenants;
    const nextCursor = hasNextPage ? items[items.length - 1]!.id : null;
    const tenantIds = items.map((t) => t.id);

    // Batched: staff and student numbers in 3 queries, courses in 1, for the whole page.
    const [staff, courseCounts] = await Promise.all([
      this.staffOf(tenantIds),
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

    const courseCountMap = new Map(courseCounts.map((c) => [c.tenantId, c._count.id]));

    return {
      items: items.map((t) => {
        const s = staff(t.id);
        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          status: t.status,
          pausedRoles: t.pausedRoles,
          ...s,
          usage: {
            studentCount: s.studentCount,
            courseCount: courseCountMap.get(t.id) ?? 0,
            storageBytes: 0,
          },
          createdAt: t.createdAt.toISOString(),
        };
      }),
      nextCursor,
    };
  }

  /**
   * D8 (10R.5): all teachers (oldest first, with membership status) plus active assistant and
   * student counts, for any set of tenants in three queries.
   */
  private async staffOf(tenantIds: string[]) {
    const [teachers, counts] = await Promise.all([
      this.db.membership.findMany({
        where: { tenantId: { in: tenantIds }, role: "teacher" },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          tenantId: true,
          status: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.db.membership.groupBy({
        by: ["tenantId", "role"],
        where: { tenantId: { in: tenantIds }, role: { in: ["assistant", "student"] }, status: "active" },
        _count: { id: true },
      }),
    ]);
    const count = (tenantId: string, role: "assistant" | "student") =>
      counts.find((c) => c.tenantId === tenantId && c.role === role)?._count.id ?? 0;
    return (tenantId: string) => ({
      teachers: teachers
        .filter((t) => t.tenantId === tenantId)
        .map((t) => ({ ...t.user, status: t.status })),
      assistantCount: count(tenantId, "assistant"),
      studentCount: count(tenantId, "student"),
    });
  }

  /** Retrieves single tenant details with live usage breakdown. */
  async getById(id: string): Promise<AdminTenantListItem> {
    const tenant = await this.db.tenant.findFirst({
      where: { id, deletedAt: null },
    });

    if (!tenant) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "TENANT_NOT_FOUND",
        code: "TENANT_NOT_FOUND",
        message: "Tenant not found",
      });
    }

    return this.toItem(tenant);
  }

  /** One tenant with its teachers, counts and usage (D8). */
  private async toItem(tenant: {
    id: string;
    slug: string;
    name: string;
    status: "active" | "deleted";
    pausedRoles: ("teacher" | "assistant" | "student")[];
    createdAt: Date;
  }): Promise<AdminTenantListItem> {
    const [staff, courseCount] = await Promise.all([
      this.staffOf([tenant.id]),
      this.db.course.count({
        where: { tenantId: tenant.id, status: "published", deletedAt: null },
      }),
    ]);
    const s = staff(tenant.id);
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      pausedRoles: tenant.pausedRoles,
      ...s,
      usage: { studentCount: s.studentCount, courseCount, storageBytes: 0 },
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
        reason: "TENANT_NOT_FOUND",
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
          reason: "SLUG_ALREADY_EXISTS",
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

    return this.toItem(updatedTenant);
  }

  /** Soft-deletes a tenant, terminates all its sessions, and invalidates resolver cache. */
  async softDelete(actorUserId: string, id: string): Promise<AdminTenantSoftDeleteResponse> {
    const currentTenant = await this.db.tenant.findFirst({
      where: { id, deletedAt: null },
    });

    if (!currentTenant) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "TENANT_NOT_FOUND",
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

      const staffMembers = await tx.membership.findMany({
        where: {
          tenantId: id,
          role: { in: ["teacher", "assistant"] },
          user: { isSuperAdmin: false },
        },
        select: { userId: true },
      });
      const staffUserIds = staffMembers.map((m) => m.userId);

      const delRes = await tx.session.deleteMany({
        where: {
          OR: [
            { tenantId: id },
            ...(staffUserIds.length > 0 ? [{ userId: { in: staffUserIds } }] : []),
          ],
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
        code: "CANNOT_SUSPEND_SELF",
        message: "Super admin cannot suspend their own account.",
      });
    }

    const user = await this.db.user.findUnique({
      where: { id: targetUserId },
    });

    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "USER_NOT_FOUND",
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }

    return this.db.$transaction(async (tx) => {
      // T5 (FR-T03): suspending the person suspends their teaching everywhere, so no tenant may
      // lose its last active teacher this way either.
      if (dto.status === "suspended" && user.status === "active") {
        const teaching = await tx.membership.findMany({
          where: { userId: targetUserId, role: "teacher", status: "active" },
          select: { tenantId: true },
        });
        await assertTeacherRemains(
          tx,
          teaching.map((t) => t.tenantId),
          { userId: targetUserId },
        );
      }
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: { status: dto.status, isMinor: dto.isMinor },
        select: { id: true, name: true, email: true, status: true, isMinor: true },
      });

      // 10R.7 (FR-A06): a person-level flag, so only the super admin changes it after creation.
      if (dto.isMinor !== undefined && dto.isMinor !== user.isMinor) {
        await this.audit.record(
          {
            action: "user.minor_flag_change",
            targetType: "user",
            targetId: targetUserId,
            tenantId: null,
            actorUserId,
            meta: { previous: user.isMinor, isMinor: dto.isMinor },
          },
          tx,
        );
      }
      if (dto.status === undefined) {
        return { ...updated, sessionsEvicted: 0 };
      }

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
        isMinor: updated.isMinor,
        sessionsEvicted,
      };
    });
  }

  /**
   * FR-A07 (10R.3): only the super admin sets another user's password, for example when an
   * unverified address cannot receive a reset link. Never a super admin's (bootstrap recovery).
   * The user must choose their own password at the next sign-in; every session ends at once.
   * The password is hashed here and never logged, audited or returned.
   */
  async setUserPassword(
    actorUserId: string,
    targetUserId: string,
    newPassword: string,
  ): Promise<{ sessionsEnded: number }> {
    const user = await this.db.user.findUnique({
      where: { id: targetUserId },
      select: { isSuperAdmin: true },
    });
    if (!user) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "USER_NOT_FOUND",
        message: "User not found",
      });
    }
    if (user.isSuperAdmin) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AccessReasonCode.ROLE_FORBIDDEN,
        message: "A super admin's password is reset only with the bootstrap recovery command.",
      });
    }
    const min = await requiredPasswordLength(targetUserId);
    if (newPassword.length < min) {
      throw new BadRequestException({
        statusCode: 400,
        reason: PASSWORD_TOO_SHORT,
        message: `Password must be at least ${min} characters.`,
      });
    }
    const hash = await (await this.auth.$context).password.hash(newPassword);

    return this.db.$transaction(async (tx) => {
      const { count } = await tx.account.updateMany({
        where: { userId: targetUserId, providerId: "credential" },
        data: { password: hash },
      });
      if (count === 0) {
        await tx.account.create({
          data: {
            userId: targetUserId,
            accountId: targetUserId,
            providerId: "credential",
            password: hash,
          },
        });
      }
      await tx.user.update({ where: { id: targetUserId }, data: { mustChangePassword: true } });
      // Every session on every tenant ends; open SSE streams close at their next session check.
      const { count: sessionsEnded } = await tx.session.deleteMany({
        where: { userId: targetUserId },
      });
      await this.audit.record(
        {
          action: "user.password_reset_by_admin",
          targetType: "user",
          targetId: targetUserId,
          tenantId: null,
          actorUserId,
          meta: { sessionsEnded },
        },
        tx,
      );
      return { sessionsEnded };
    });
  }
}
