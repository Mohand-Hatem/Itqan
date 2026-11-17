import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { type Auth, type AuthUser, sendInvitationEmail, verifyCredentials } from "@itqan/auth";
import { getRequestContext, type ScopedPrismaClient, systemPrisma } from "@itqan/database";
import {
  AccessReasonCode,
  type InvitationAcceptInput,
  type InvitationAcceptWithPasswordInput,
  type InvitationCreateInput,
  type InvitationListQueryInput,
  type InvitationRegisterInput,
  PASSWORD_MIN_LENGTH,
  GuardianConsentReason,
  PASSWORD_TOO_SHORT,
  ProvisioningReason,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { courseAccessNotification } from "../notifications/notification-inputs.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { AUTH_INSTANCE } from "../auth/session.guard.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import {
  assertMayGiveRole,
  isStaffRole,
  type ProvisionActor,
} from "../provisioning/provisioning.service.js";
import { joinLink } from "./join-link.js";
import { GuardianConsentService } from "../guardian-consent/guardian-consent.service.js";
import { defaultMaxDevices } from "../settings/default-max-devices.js";

/** One Resend key per (invitation, token): a retried send of the same email goes out once. */
const invitationEmailKey = (id: string, tokenHash: string) =>
  `invitation:${id}:${tokenHash.slice(0, 16)}`;

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(GuardianConsentService) private readonly consent: GuardianConsentService,
  ) {}

  /** The academy's own host for its join link, from the request host (admin.x → slug.x). */
  async tenantHostFor(tenantId: string, requestHost: string) {
    const tenant = await systemPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    if (!tenant) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "TENANT_NOT_FOUND",
        message: "Tenant not found.",
      });
    }
    return requestHost.replace(/^[^.]+\./, `${tenant.slug}.`);
  }

  /** Tenant host: the tenant comes from the request. */
  create(input: InvitationCreateInput, actor: ProvisionActor, host: string) {
    const context = getRequestContext();
    if (context?.kind !== "tenant") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }
    return this.createIn(context.tenantId, input, actor, host);
  }

  /**
   * FR-E01 (10R.6): an invitation for any allowed role. The super admin route passes the tenant
   * explicitly (its host has no tenant scope), so every query names it.
   */
  async createIn(tenantId: string, input: InvitationCreateInput, actor: ProvisionActor, host: string) {
    assertMayGiveRole(actor, input.role);
    const tenant = await systemPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true, status: true },
    });
    if (tenant?.status !== "active") {
      throw new NotFoundException({
        statusCode: 404,
        reason: "TENANT_NOT_FOUND",
        message: "Tenant not found.",
      });
    }

    const courses = await systemPrisma.course.findMany({
      where: { id: { in: input.courseIds }, tenantId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (courses.length !== input.courseIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_COURSES",
        message: "One or more selected courses were not found.",
      });
    }

    const existing = await systemPrisma.invitation.findFirst({
      where: {
        tenantId,
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
    // A person has one role per academy: a staff invitation to an existing member cannot work.
    if (isStaffRole(input.role)) {
      const member = await systemPrisma.membership.findFirst({
        where: { tenantId, user: { email: input.email } },
        select: { id: true },
      });
      if (member) {
        throw new ConflictException({
          statusCode: 409,
          reason: ProvisioningReason.MEMBERSHIP_ALREADY_EXISTS,
          message: "This person already belongs to this academy.",
        });
      }
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);

    const invitation = await systemPrisma.$transaction(async (tx) => {
      const inv = await tx.invitation.create({
        data: {
          tenantId,
          email: input.email,
          role: input.role,
          tokenHash,
          courseIds: input.courseIds,
          expiresAt,
          createdBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          action: "invitation.create",
          targetType: "invitation",
          targetId: inv.id,
          tenantId,
          actorUserId: actor.userId,
          meta: { email: input.email, role: input.role, courseIds: input.courseIds },
        },
        tx,
      );

      return inv;
    });

    // After commit; a failed send keeps the invitation, and staff can resend it.
    await sendInvitationEmail({
      to: input.email,
      url: joinLink(host, rawToken),
      tenantName: tenant.name,
      courseTitles: courses.map((c) => c.title),
      role: input.role,
      idempotencyKey: invitationEmailKey(invitation.id, tokenHash),
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      courseIds: invitation.courseIds,
      expiresAt: invitation.expiresAt,
      // No token here: it travels only by email, never to the staff member (security audit, Phase 6).
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

    const rows = await this.db.invitation
      .findMany({
        where: {
          ...statusFilter,
        },
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
      })
      .catch((err) => {
        if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
          throw new BadRequestException({
            statusCode: 400,
            reason: "INVALID_CURSOR",
            message: "Cursor record not found.",
          });
        }
        throw err;
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

    const url = joinLink(host, rawToken);
    await sendInvitationEmail({
      to: updated.email,
      url,
      tenantName: tenant.name,
      courseTitles: courses.map((c) => c.title),
      role: updated.role,
      // The token changed, so this is a new message with its own key.
      idempotencyKey: invitationEmailKey(updated.id, tokenHash),
    });

    return { id: updated.id, email: updated.email, expiresAt: updated.expiresAt };
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
      role: inv.role,
      tenant: inv.tenant,
      courses,
      userExists: !!existingUser,
    };
  }

  async register(input: InvitationRegisterInput, host: string) {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    let tenantId = "";
    let isMinor = false;

    const result = await systemPrisma.$transaction(async (tx) => {
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
      // FR-A09: a staff invitation needs a staff-length password (the claim rolls back on error).
      const min = isStaffRole(inv.role) ? PASSWORD_MIN_LENGTH.staff : PASSWORD_MIN_LENGTH.student;
      if (input.password.length < min) {
        throw new BadRequestException({
          statusCode: 400,
          reason: PASSWORD_TOO_SHORT,
          message: `Password must be at least ${min} characters.`,
        });
      }

      // 10R.7 (FR-A06): only a student account is marked under 18.
      tenantId = inv.tenantId;
      isMinor = inv.role === "student" && input.isMinor;
      if (input.guardian && input.guardian.email === inv.email) {
        throw new BadRequestException({
          statusCode: 400,
          reason: GuardianConsentReason.GUARDIAN_EMAIL_SAME_AS_STUDENT,
          message: "The guardian's email must be different from the student's.",
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
          isMinor,
          maxDevices: await defaultMaxDevices(tx, inv.tenantId),
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

      // The invited role (10R.6); the person chose this password, so no first-login change.
      const membership = await tx.membership.create({
        data: {
          tenantId: inv.tenantId,
          userId: user.id,
          role: inv.role,
          phone: input.phone ?? null,
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
          meta: { email: user.email, membershipId: membership.id, role: inv.role },
        },
        tx,
      );

      return {
        userId: user.id,
        membershipId: membership.id,
        role: inv.role,
        email: user.email,
      };
    });

    if (isMinor && input.guardian) {
      await this.consent.requestAfterRegistration(result.userId, input.guardian, tenantId, host);
    }
    return result;
  }

  /** A signed-in account accepts (its session proves the account). */
  accept(input: InvitationAcceptInput, authUser: AuthUser) {
    return this.acceptAs(input.token, authUser, "session");
  }

  /**
   * C1 (10R.6): an account that cannot sign in yet (pending: its verification link was never used)
   * accepts with the invitation token and its own password. The token proves the mailbox, the
   * password proves the account; the password itself never changes. Rate-limited per IP.
   */
  async acceptWithPassword(input: InvitationAcceptWithPasswordInput) {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const inv = await systemPrisma.invitation.findUnique({
      where: { tokenHash },
      select: { email: true },
    });
    // verifyCredentials hashes on a miss too, so timing does not reveal which part failed.
    const user = await verifyCredentials(
      await this.auth.$context,
      inv?.email ?? "unknown@invalid",
      input.password,
    );
    if (!inv || !user) {
      throw new UnauthorizedException({
        statusCode: 401,
        reason: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid invitation or password.",
      });
    }
    return this.acceptAs(input.token, user, "password");
  }

  /**
   * One transaction: claim the invitation, prove the mailbox (T2: email verified, `pending`
   * becomes `active`), add the membership with the invited role, and enroll a student.
   */
  private async acceptAs(
    rawToken: string,
    authUser: { id: string; email: string },
    method: "session" | "password",
  ) {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    const { result, afterCommit } = await systemPrisma.$transaction(async (tx) => {
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

      const account = await tx.user.findUniqueOrThrow({
        where: { id: authUser.id },
        select: { status: true, isSuperAdmin: true },
      });
      if (account.status === "suspended") {
        throw new ForbiddenException({
          statusCode: 403,
          reason: AccessReasonCode.USER_SUSPENDED,
          message: "Your account is suspended.",
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
        // One role per academy: a staff invitation cannot change an existing membership.
        if (inv.role !== "student") {
          throw new ConflictException({
            statusCode: 409,
            reason: ProvisioningReason.MEMBERSHIP_ALREADY_EXISTS,
            message: "You already belong to this academy.",
          });
        }
        if (membership.role !== "student") {
          throw new ForbiddenException({
            statusCode: 403,
            reason: "ROLE_FORBIDDEN",
            message: "Staff members cannot accept student course invitations.",
          });
        }
      } else {
        // T4 (FR-A09): a first staff role means choosing a new password under the 12 rule.
        if (isStaffRole(inv.role) && !account.isSuperAdmin) {
          const staffRoles = await tx.membership.count({
            where: { userId: authUser.id, role: { in: ["teacher", "assistant"] }, status: "active" },
          });
          if (staffRoles === 0) {
            await tx.user.update({ where: { id: authUser.id }, data: { mustChangePassword: true } });
          }
        }
        membership = await tx.membership.create({
          data: {
            tenantId: inv.tenantId,
            userId: authUser.id,
            role: inv.role,
          },
        });
      }

      // T2: the emailed token proves the mailbox, so the address is verified and a self-registered
      // account waiting for its link becomes usable. Never wakes a suspended account (checked above).
      await tx.user.update({
        where: { id: authUser.id },
        data: {
          emailVerified: true,
          ...(account.status === "pending" ? { status: "active" as const } : {}),
        },
      });

      const activeCourses =
        inv.role === "student"
          ? await tx.course.findMany({
              where: { id: { in: inv.courseIds }, tenantId: inv.tenantId, deletedAt: null },
              select: { id: true, title: true, tenantId: true },
            })
          : [];

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
          meta: { email: authUser.email, membershipId: membership.id, role: inv.role, method },
        },
        tx,
      );

      const afterCommit = await this.notifications.stage(
        tx,
        activeCourses.map((course) => courseAccessNotification(authUser.id, course)),
      );
      return { result: { membershipId: membership.id, role: inv.role }, afterCommit };
    });
    afterCommit();
    return result;
  }
}
