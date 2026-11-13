import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { type Auth, type AuthUser, sendInvitationEmail } from "@itqan/auth";
import { getRequestContext, type ScopedPrismaClient, systemPrisma } from "@itqan/database";
import type {
  InvitationAcceptInput,
  InvitationCreateInput,
  InvitationListQueryInput,
  InvitationRegisterInput,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { AUTH_INSTANCE } from "../auth/session.guard.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
  ) {}

  async create(input: InvitationCreateInput, actorUserId: string, host: string) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const courses = await this.db.course.findMany({
      where: { id: { in: input.courseIds }, deletedAt: null },
      select: { id: true, title: true },
    });
    if (courses.length !== input.courseIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_COURSES",
        message: "One or more selected courses were not found.",
      });
    }

    const existing = await this.db.invitation.findFirst({
      where: {
        email: input.email,
        redeemedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        reason: "INVITATION_ALREADY_EXISTS",
        message: "An active invitation already exists for this email address.",
      });
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

    const invitation = await this.db.$transaction(async (tx) => {
      const inv = await tx.invitation.create({
        data: {
          tenantId,
          email: input.email,
          tokenHash,
          courseIds: input.courseIds,
          expiresAt,
          createdBy: actorUserId,
        },
      });

      await this.audit.record(
        {
          action: "invitation.create",
          targetType: "invitation",
          targetId: inv.id,
          actorUserId,
          meta: { email: input.email, courseIds: input.courseIds },
        },
        tx,
      );

      return inv;
    });

    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true },
    });
    const url = `http://${host}/join?token=${rawToken}`;
    await sendInvitationEmail({
      to: input.email,
      url,
      tenantName: tenant.name,
      courseTitles: courses.map((c) => c.title),
    });

    return {
      id: invitation.id,
      email: invitation.email,
      courseIds: invitation.courseIds,
      expiresAt: invitation.expiresAt,
      token: rawToken,
    };
  }

  async list(query: InvitationListQueryInput) {
    const now = new Date();
    let statusFilter = {};
    if (query.status === "pending") {
      statusFilter = { redeemedAt: null, revokedAt: null, expiresAt: { gt: now } };
    } else if (query.status === "redeemed") {
      statusFilter = { redeemedAt: { not: null } };
    } else if (query.status === "revoked") {
      statusFilter = { revokedAt: { not: null } };
    } else if (query.status === "expired") {
      statusFilter = { redeemedAt: null, revokedAt: null, expiresAt: { lte: now } };
    }

    const rows = await this.db.invitation.findMany({
      where: {
        ...statusFilter,
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: query.limit + 1,
      select: {
        id: true,
        email: true,
        courseIds: true,
        expiresAt: true,
        redeemedAt: true,
        redeemedBy: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    const page = rows.slice(0, query.limit);
    return {
      items: page,
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  async resend(id: string, actorUserId: string, host: string) {
    const existing = await this.db.invitation.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "INVITATION_NOT_FOUND",
        message: "Invitation not found.",
      });
    }
    if (existing.redeemedAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVITATION_ALREADY_REDEEMED",
        message: "This invitation has already been redeemed.",
      });
    }
    if (existing.revokedAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVITATION_REVOKED",
        message: "This invitation was revoked.",
      });
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

    const updated = await this.db.$transaction(async (tx) => {
      const inv = await tx.invitation.update({
        where: { id },
        data: {
          tokenHash,
          expiresAt,
        },
      });

      await this.audit.record(
        {
          action: "invitation.resend",
          targetType: "invitation",
          targetId: id,
          actorUserId,
          meta: { email: inv.email },
        },
        tx,
      );

      return inv;
    });

    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: updated.tenantId },
      select: { name: true },
    });
    const courses = await this.db.course.findMany({
      where: { id: { in: updated.courseIds }, deletedAt: null },
      select: { title: true },
    });

    const url = `http://${host}/join?token=${rawToken}`;
    await sendInvitationEmail({
      to: updated.email,
      url,
      tenantName: tenant.name,
      courseTitles: courses.map((c) => c.title),
    });

    return { id: updated.id, email: updated.email, expiresAt: updated.expiresAt, token: rawToken };
  }

  async revoke(id: string, actorUserId: string) {
    const existing = await this.db.invitation.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "INVITATION_NOT_FOUND",
        message: "Invitation not found.",
      });
    }
    if (existing.redeemedAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVITATION_ALREADY_REDEEMED",
        message: "This invitation has already been redeemed.",
      });
    }
    if (existing.revokedAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVITATION_ALREADY_REVOKED",
        message: "This invitation has already been revoked.",
      });
    }

    const updated = await this.db.$transaction(async (tx) => {
      const inv = await tx.invitation.update({
        where: { id },
        data: { revokedAt: new Date() },
      });

      await this.audit.record(
        {
          action: "invitation.revoke",
          targetType: "invitation",
          targetId: id,
          actorUserId,
          meta: { email: inv.email },
        },
        tx,
      );

      return inv;
    });

    return { id: updated.id, revoked: true };
  }

  async check(rawToken: string) {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const inv = await systemPrisma.invitation.findUnique({
      where: { tokenHash },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!inv) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "INVITATION_NOT_FOUND",
        message: "Invitation link is invalid.",
      });
    }
    if (inv.revokedAt) {
      throw new GoneException({
        statusCode: 410,
        reason: "INVITATION_REVOKED",
        message: "This invitation was revoked.",
      });
    }
    if (inv.redeemedAt) {
      throw new GoneException({
        statusCode: 410,
        reason: "INVITATION_ALREADY_REDEEMED",
        message: "This invitation has already been redeemed.",
      });
    }
    if (inv.expiresAt <= new Date()) {
      throw new GoneException({
        statusCode: 410,
        reason: "INVITATION_EXPIRED",
        message: "This invitation has expired.",
      });
    }

    const courses = await systemPrisma.course.findMany({
      where: { id: { in: inv.courseIds }, deletedAt: null },
      select: { id: true, title: true, description: true },
    });

    const existingUser = await systemPrisma.user.findUnique({
      where: { email: inv.email },
      select: { id: true },
    });

    return {
      valid: true,
      email: inv.email,
      tenant: inv.tenant,
      courses,
      userExists: !!existingUser,
    };
  }

  async register(input: InvitationRegisterInput) {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");

    return systemPrisma.$transaction(async (tx) => {
      // Atomic claim
      const claimed = await tx.invitation.updateMany({
        where: {
          tokenHash,
          redeemedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { redeemedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          reason: "INVITATION_NOT_AVAILABLE",
          message: "This invitation is invalid, expired, revoked, or has already been used.",
        });
      }

      const inv = await tx.invitation.findUniqueOrThrow({
        where: { tokenHash },
      });

      const existingUser = await tx.user.findUnique({
        where: { email: inv.email },
      });
      if (existingUser) {
        throw new ConflictException({
          statusCode: 409,
          reason: "USER_ALREADY_EXISTS",
          message:
            "An account with this email already exists. Please sign in to accept the invitation.",
        });
      }

      const ctx = await this.auth.$context;
      const passwordHash = await ctx.password.hash(input.password);

      const user = await tx.user.create({
        data: {
          email: inv.email,
          name: input.name,
          emailVerified: true,
          status: "active",
          maxDevices: 1,
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

      const membership = await tx.membership.create({
        data: {
          tenantId: inv.tenantId,
          userId: user.id,
          role: "student",
          phone: input.phone ?? null,
          guardianConsentAt: input.guardianConsent ? new Date() : null,
        },
      });

      const activeCourses = await tx.course.findMany({
        where: { id: { in: inv.courseIds }, tenantId: inv.tenantId, deletedAt: null },
        select: { id: true },
      });

      for (const course of activeCourses) {
        await tx.enrollment.create({
          data: {
            tenantId: inv.tenantId,
            membershipId: membership.id,
            courseId: course.id,
            source: "invitation",
            grantedBy: inv.createdBy,
          },
        });
      }

      await tx.invitation.update({
        where: { id: inv.id },
        data: { redeemedBy: user.id },
      });

      await this.audit.record(
        {
          action: "invitation.redeem",
          tenantId: inv.tenantId,
          targetType: "invitation",
          targetId: inv.id,
          actorUserId: user.id,
          meta: { email: user.email, membershipId: membership.id },
        },
        tx,
      );

      return {
        userId: user.id,
        membershipId: membership.id,
        email: user.email,
      };
    });
  }

  async accept(input: InvitationAcceptInput, authUser: AuthUser) {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");

    return systemPrisma.$transaction(async (tx) => {
      // Atomic claim
      const claimed = await tx.invitation.updateMany({
        where: {
          tokenHash,
          redeemedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { redeemedAt: new Date() },
      });

      if (claimed.count === 0) {
        throw new ConflictException({
          statusCode: 409,
          reason: "INVITATION_NOT_AVAILABLE",
          message: "This invitation is invalid, expired, revoked, or has already been used.",
        });
      }

      const inv = await tx.invitation.findUniqueOrThrow({
        where: { tokenHash },
      });

      if (authUser.email.toLowerCase() !== inv.email.toLowerCase()) {
        throw new ForbiddenException({
          statusCode: 403,
          reason: "EMAIL_MISMATCH",
          message: "Your signed-in email address does not match this invitation.",
        });
      }

      let membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: inv.tenantId, userId: authUser.id } },
      });

      if (membership) {
        if (membership.status === "suspended") {
          throw new ForbiddenException({
            statusCode: 403,
            reason: "MEMBERSHIP_SUSPENDED",
            message: "Your membership on this academy is suspended.",
          });
        }
      } else {
        membership = await tx.membership.create({
          data: {
            tenantId: inv.tenantId,
            userId: authUser.id,
            role: "student",
            guardianConsentAt: input.guardianConsent ? new Date() : null,
          },
        });
      }

      const activeCourses = await tx.course.findMany({
        where: { id: { in: inv.courseIds }, tenantId: inv.tenantId, deletedAt: null },
        select: { id: true },
      });

      for (const course of activeCourses) {
        await tx.enrollment.upsert({
          where: {
            membershipId_courseId: {
              membershipId: membership.id,
              courseId: course.id,
            },
          },
          create: {
            tenantId: inv.tenantId,
            membershipId: membership.id,
            courseId: course.id,
            source: "invitation",
            grantedBy: inv.createdBy,
          },
          update: { status: "active" },
        });
      }

      await tx.invitation.update({
        where: { id: inv.id },
        data: { redeemedBy: authUser.id },
      });

      await this.audit.record(
        {
          action: "invitation.accept",
          tenantId: inv.tenantId,
          targetType: "invitation",
          targetId: inv.id,
          actorUserId: authUser.id,
          meta: { email: authUser.email, membershipId: membership.id },
        },
        tx,
      );

      return {
        membershipId: membership.id,
      };
    });
  }
}
