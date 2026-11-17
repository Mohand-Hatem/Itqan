// One place that creates accounts and memberships directly (10R.4, ADR-013, docs/06 §0).
// Invitations (the other mode) reuse the membership rules in 10R.6.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Auth } from "@itqan/auth";
import { type Prisma, PrismaClient, type Role } from "@itqan/database";
import {
  AccessReasonCode,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_SHORT,
  ProvisioningReason,
  type ProvisionResult,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { AUTH_INSTANCE } from "../auth/session.guard.js";
import { defaultMaxDevices } from "../settings/default-max-devices.js";
import { consentStateOf } from "../guardian-consent/consent-state.js";

export type ProvisionActor = {
  userId: string;
  isSuperAdmin: boolean;
  /** The actor's role in the target tenant; none for a super admin without a membership. */
  role?: Role;
};

export type ProvisionInput = {
  tenantId: string;
  actor: ProvisionActor;
  role: Role;
  email: string;
  name?: string;
  password?: string;
  phone?: string;
  courseIds?: string[];
  /** Students only (FR-A08); staff created directly always change their password. */
  requirePasswordChange?: boolean;
  /** 10R.7 (FR-A06): new student accounts only; a linked account keeps its own value. */
  isMinor?: boolean;
  /** Audit action; defaults to `member.create`. */
  auditAction?: string;
};

const newUserIsMinor = (input: ProvisionInput) => input.role === "student" && (input.isMinor ?? false);

/** Who may give which role (docs/06 §0). The super admin may give any. */
const MAY_CREATE: Partial<Record<Role, Role[]>> = {
  teacher: ["assistant", "student"],
  assistant: ["student"],
};

export const isStaffRole = (role: Role) => role === "teacher" || role === "assistant";

/** Throws 403 unless this actor may give this role (direct creation and invitations alike). */
export function assertMayGiveRole(actor: ProvisionActor, role: Role) {
  if (actor.isSuperAdmin || (actor.role && MAY_CREATE[actor.role]?.includes(role))) return;
  throw new ForbiddenException({
    statusCode: 403,
    reason: AccessReasonCode.ROLE_FORBIDDEN,
    message: "Your role cannot create this kind of account.",
  });
}

@Injectable()
export class ProvisioningService {
  constructor(
    @Inject(PrismaClient) private readonly db: PrismaClient,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Direct creation in its own transaction. */
  provision(input: ProvisionInput): Promise<ProvisionResult> {
    return this.db.$transaction((tx) => this.provisionIn(tx, input));
  }

  /**
   * Direct creation inside the caller's transaction (tenant creation uses this). Queries name
   * `tenantId` explicitly, because the super admin host has no tenant scope.
   */
  async provisionIn(tx: Prisma.TransactionClient, input: ProvisionInput): Promise<ProvisionResult> {
    const { actor, role, tenantId } = input;
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    if (tenant?.status !== "active") {
      throw new NotFoundException({
        statusCode: 404,
        reason: "TENANT_NOT_FOUND",
        message: "Tenant not found.",
      });
    }
    assertMayGiveRole(actor, role);

    const email = input.email.trim().toLowerCase();
    const existing = await tx.user.findUnique({
      where: { email },
      select: { id: true, emailVerified: true, mustChangePassword: true, isSuperAdmin: true, isMinor: true },
    });

    if (existing) {
      const member = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: existing.id } },
        select: { id: true },
      });
      if (member) {
        throw new ConflictException({
          statusCode: 409,
          reason: ProvisioningReason.MEMBERSHIP_ALREADY_EXISTS,
          message: "This person already belongs to this academy.",
        });
      }
      // D3: only the super admin links an existing account; staff invite the person instead.
      if (!actor.isSuperAdmin) {
        throw new ConflictException({
          statusCode: 409,
          reason: ProvisioningReason.USE_INVITATION,
          message: "This email already has an account. Send an invitation instead.",
        });
      }
    }

    const userId = existing ? existing.id : await this.createUser(tx, input, email);
    let mustChangePassword = existing ? existing.mustChangePassword : await this.flagOf(tx, userId);

    // T4 (FR-A09): a stored hash cannot show the password length, so an existing account's first
    // staff role makes it choose a new password under the 12-character rule.
    if (existing && isStaffRole(role) && !existing.isSuperAdmin) {
      const staffRoles = await tx.membership.count({
        where: { userId, role: { in: ["teacher", "assistant"] }, status: "active" },
      });
      if (staffRoles === 0 && !mustChangePassword) {
        await tx.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
        mustChangePassword = true;
      }
    }

    const membership = await tx.membership.create({
      data: { tenantId, userId, role, status: "active", phone: input.phone },
      select: { id: true },
    });

    const enrollmentIds =
      role === "student" ? await this.enroll(tx, input, membership.id) : [];

    await this.audit.record(
      {
        action: input.auditAction ?? "member.create",
        targetType: "membership",
        targetId: membership.id,
        tenantId,
        actorUserId: actor.userId,
        meta: {
          userId,
          role,
          mode: "direct",
          existingUserLinked: Boolean(existing),
          courseIds: enrollmentIds.length ? input.courseIds : [],
          ...(role === "student" && !existing
            ? { requirePasswordChange: input.requirePasswordChange ?? true }
            : {}),
        },
      },
      tx,
    );

    return {
      userId,
      membershipId: membership.id,
      role,
      existingUserLinked: Boolean(existing),
      emailVerified: existing?.emailVerified ?? false,
      mustChangePassword,
      enrollmentIds,
      guardianConsent: existing
        ? await consentStateOf(existing.id, existing.isMinor)
        : newUserIsMinor(input)
          ? "required"
          : "not_required",
    };
  }

  /** A new account: active, email unverified, no email sent (ADR-013). */
  private async createUser(tx: Prisma.TransactionClient, input: ProvisionInput, email: string) {
    if (!input.name) {
      throw new BadRequestException({
        statusCode: 400,
        reason: ProvisioningReason.NAME_REQUIRED,
        message: "A name is needed for a new account.",
      });
    }
    if (!input.password) {
      throw new BadRequestException({
        statusCode: 400,
        reason: ProvisioningReason.PASSWORD_REQUIRED,
        message: "A password is needed for a new account.",
      });
    }
    const min = isStaffRole(input.role) ? PASSWORD_MIN_LENGTH.staff : PASSWORD_MIN_LENGTH.student;
    if (input.password.length < min) {
      throw new BadRequestException({
        statusCode: 400,
        reason: PASSWORD_TOO_SHORT,
        message: `Password must be at least ${min} characters.`,
      });
    }

    const hash = await (await this.auth.$context).password.hash(input.password);
    const user = await tx.user.create({
      data: {
        name: input.name,
        email,
        emailVerified: false,
        status: "active",
        // FR-A08: staff always; students unless staff turned it off.
        mustChangePassword: isStaffRole(input.role) || (input.requirePasswordChange ?? true),
        isMinor: newUserIsMinor(input),
        ...(input.role === "student"
          ? { maxDevices: await defaultMaxDevices(tx, input.tenantId) }
          : {}),
      },
      select: { id: true },
    });
    await tx.account.create({
      data: { userId: user.id, accountId: user.id, providerId: "credential", password: hash },
    });
    return user.id;
  }

  private async flagOf(tx: Prisma.TransactionClient, userId: string) {
    const row = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { mustChangePassword: true },
    });
    return row.mustChangePassword;
  }

  /** Course access for a new student (FR-E07 rules: the course is this tenant's, not deleted). */
  private async enroll(tx: Prisma.TransactionClient, input: ProvisionInput, membershipId: string) {
    const courseIds = [...new Set(input.courseIds ?? [])];
    if (courseIds.length === 0) return [];
    const found = await tx.course.count({
      where: { id: { in: courseIds }, tenantId: input.tenantId, deletedAt: null },
    });
    if (found !== courseIds.length) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "COURSE_NOT_FOUND",
        message: "Course not found.",
      });
    }
    const ids: string[] = [];
    for (const courseId of courseIds) {
      const row = await tx.enrollment.create({
        data: {
          tenantId: input.tenantId,
          membershipId,
          courseId,
          status: "active",
          source: "manual",
          grantedBy: input.actor.userId,
        },
        select: { id: true },
      });
      ids.push(row.id);
    }
    return ids;
  }
}
