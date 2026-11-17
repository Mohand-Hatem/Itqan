import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { sendGuardianConsentEmail } from "@itqan/auth";
import { type Prisma, systemPrisma } from "@itqan/database";
import {
  CONSENT_POLICY_VERSION,
  type GuardianConsentConfirmInput,
  type GuardianConsentOfflineInput,
  type GuardianConsentRequestInput,
  type GuardianInfo,
  GuardianConsentReason,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { tokenLink } from "../invitations/join-link.js";
import { LIVE_CONSENT } from "./consent-state.js";

const LINK_TTL_MS = 7 * 24 * 3600 * 1000;
const REQUESTS_PER_HOUR = 3;
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
/** One Resend key per (consent, token): a retried request mails once. */
const emailKey = (id: string, tokenHash: string) => `guardian_consent:${id}:${tokenHash.slice(0, 16)}`;

const linkGone = () =>
  new GoneException({
    statusCode: 410,
    reason: GuardianConsentReason.CONSENT_LINK_NOT_AVAILABLE,
    message: "This consent link has expired or was already used.",
  });

/** Who acts and where: the academy the request or record belongs to. */
export interface ConsentActor {
  userId: string;
  tenantId: string;
}

/**
 * 10R.7 (FR-A06, ADR-014): one live consent per person (pending or given), kept by locking the
 * user row in every write. Electronic: the guardian confirms an emailed link. Offline: staff record
 * a signed form by reference only.
 */
@Injectable()
export class GuardianConsentService {
  private readonly logger = new Logger(GuardianConsentService.name);

  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** A tenant's student by membership id; the tenant filter is the isolation boundary. */
  async studentOf(membershipId: string, tenantId: string) {
    const membership = await systemPrisma.membership.findFirst({
      where: { id: membershipId, tenantId, role: "student" },
      select: { userId: true },
    });
    if (!membership) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "MEMBERSHIP_NOT_FOUND",
        message: "Student not found in this academy.",
      });
    }
    return membership.userId;
  }

  /** Locks the person and returns them with their live consent row. */
  private async lockPerson(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, isMinor: true },
    });
    if (!user.isMinor) {
      throw new ConflictException({
        statusCode: 409,
        reason: GuardianConsentReason.CONSENT_NOT_REQUIRED,
        message: "This account is not marked as under 18.",
      });
    }
    const live = await tx.guardianConsent.findFirst({ where: { userId, ...LIVE_CONSENT } });
    if (live?.status === "given") {
      throw new ConflictException({
        statusCode: 409,
        reason: GuardianConsentReason.CONSENT_ALREADY_GIVEN,
        message: "A guardian has already consented for this person.",
      });
    }
    return { user, pending: live };
  }

  /** Sends (or re-sends with a new token) the consent email to the guardian. */
  async request(userId: string, input: GuardianConsentRequestInput, actor: ConsentActor, host: string) {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = hashOf(rawToken);
    const expiresAt = new Date(Date.now() + LINK_TTL_MS);

    const { consent, user } = await systemPrisma.$transaction(async (tx) => {
      const { user, pending } = await this.lockPerson(tx, userId);
      if (input.guardianEmail === user.email.toLowerCase()) {
        throw new BadRequestException({
          statusCode: 400,
          reason: GuardianConsentReason.GUARDIAN_EMAIL_SAME_AS_STUDENT,
          message: "The guardian's email must be different from the student's.",
        });
      }
      // shortcut: counted from the audit log under the user lock; a table of its own if this grows.
      const recent = await tx.auditLog.count({
        where: {
          action: "guardian_consent.request",
          targetType: "user",
          targetId: userId,
          createdAt: { gt: new Date(Date.now() - 3600 * 1000) },
        },
      });
      if (recent >= REQUESTS_PER_HOUR) {
        throw new HttpException(
          {
            statusCode: 429,
            reason: GuardianConsentReason.CONSENT_REQUEST_LIMIT,
            message: "Too many consent emails for this student. Try again in an hour.",
          },
          429,
        );
      }

      const data = {
        guardianName: input.guardianName,
        guardianRelationship: input.relationship,
        guardianEmail: input.guardianEmail,
        tokenHash,
        expiresAt,
        recordedByUserId: actor.userId,
        recordedTenantId: actor.tenantId,
      };
      const consent = pending
        ? await tx.guardianConsent.update({ where: { id: pending.id }, data })
        : await tx.guardianConsent.create({
            data: { ...data, userId, status: "pending", method: "electronic_email" },
          });

      await this.audit.record(
        {
          action: "guardian_consent.request",
          targetType: "user",
          targetId: userId,
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          meta: { consentId: consent.id, method: "electronic_email" },
        },
        tx,
      );
      return { consent, user };
    });

    const tenant = await systemPrisma.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: { name: true },
    });
    // After commit; a failed send keeps the pending row and the request can be repeated.
    await sendGuardianConsentEmail({
      to: input.guardianEmail,
      studentName: user.name,
      tenantName: tenant.name,
      url: tokenLink(host, "/guardian-consent", rawToken),
      idempotencyKey: emailKey(consent.id, tokenHash),
    });

    // No token: it travels only by email to the guardian.
    return { id: consent.id, status: "pending" as const, expiresAt: consent.expiresAt };
  }

  /**
   * After a minor's registration commits: email the guardian they named. A failure never undoes the
   * new account; the student or staff can send the request again.
   */
  async requestAfterRegistration(
    userId: string,
    guardian: GuardianInfo,
    tenantId: string,
    host: string,
  ) {
    try {
      await this.request(
        userId,
        { guardianName: guardian.name, relationship: guardian.relationship, guardianEmail: guardian.email },
        { userId, tenantId },
        host,
      );
    } catch (error) {
      this.logger.warn(`Guardian consent request after registration failed: ${(error as Error).message}`);
    }
  }

  /** Public: what the guardian is agreeing to, for the confirmation page. */
  async check(token: string) {
    const consent = await systemPrisma.guardianConsent.findUnique({
      where: { tokenHash: hashOf(token) },
      select: {
        status: true,
        expiresAt: true,
        user: { select: { name: true } },
        recordedTenant: { select: { name: true } },
      },
    });
    if (!consent || consent.status !== "pending" || !consent.expiresAt || consent.expiresAt <= new Date()) {
      throw linkGone();
    }
    return {
      studentName: consent.user.name,
      tenantName: consent.recordedTenant?.name ?? null,
      policyVersion: CONSENT_POLICY_VERSION,
      expiresAt: consent.expiresAt,
    };
  }

  /** Public: the guardian agrees. One atomic claim, so a link works once. */
  async confirm(input: GuardianConsentConfirmInput, ip: string | null, userAgent: string | null) {
    const tokenHash = hashOf(input.token);
    return systemPrisma.$transaction(async (tx) => {
      const consent = await tx.guardianConsent.findUnique({ where: { tokenHash } });
      const claimed = consent
        ? await tx.guardianConsent.updateMany({
            where: { id: consent.id, status: "pending", expiresAt: { gt: new Date() } },
            data: {
              status: "given",
              tokenHash: null,
              obtainedAt: new Date(),
              guardianName: input.guardianName,
              guardianRelationship: input.relationship,
              policyVersion: CONSENT_POLICY_VERSION,
              ip,
              userAgent: userAgent?.slice(0, 500) ?? null,
            },
          })
        : { count: 0 };
      if (!consent || claimed.count === 0) throw linkGone();

      await this.audit.record(
        {
          action: "guardian_consent.given",
          targetType: "user",
          targetId: consent.userId,
          tenantId: consent.recordedTenantId,
          // No actor: the guardian has no account.
          meta: { consentId: consent.id, method: "electronic_email", policyVersion: CONSENT_POLICY_VERSION },
        },
        tx,
      );
      return { status: "given" as const };
    });
  }

  /** Staff record a signed form they saw. A pending email request is replaced by this record. */
  async recordOffline(userId: string, input: GuardianConsentOfflineInput, actor: ConsentActor) {
    const obtainedAt = new Date(`${input.obtainedOn}T00:00:00Z`);
    if (obtainedAt > new Date()) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_BODY",
        message: "The consent date cannot be in the future.",
      });
    }
    return systemPrisma.$transaction(async (tx) => {
      const { pending } = await this.lockPerson(tx, userId);
      const data = {
        status: "given" as const,
        method: "offline" as const,
        guardianName: input.guardianName,
        guardianRelationship: input.relationship,
        guardianEmail: null,
        tokenHash: null,
        expiresAt: null,
        obtainedAt,
        recordedByUserId: actor.userId,
        recordedTenantId: actor.tenantId,
        evidenceReference: input.evidenceReference,
        notes: input.notes ?? null,
      };
      const consent = pending
        ? await tx.guardianConsent.update({ where: { id: pending.id }, data })
        : await tx.guardianConsent.create({ data: { ...data, userId } });

      await this.audit.record(
        {
          action: "guardian_consent.record_offline",
          targetType: "user",
          targetId: userId,
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          meta: { consentId: consent.id, evidenceReference: input.evidenceReference },
        },
        tx,
      );
      return { id: consent.id, status: "given" as const, method: "offline" as const, obtainedAt };
    });
  }

  /** Closes content again in every academy (FR-A06). The row stays as history. */
  async withdraw(userId: string, actor: ConsentActor) {
    return systemPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${userId}::uuid FOR UPDATE`;
      const live = await tx.guardianConsent.findFirst({ where: { userId, ...LIVE_CONSENT } });
      if (!live) {
        throw new NotFoundException({
          statusCode: 404,
          reason: GuardianConsentReason.NO_CONSENT_TO_WITHDRAW,
          message: "There is no consent to withdraw.",
        });
      }
      await tx.guardianConsent.update({
        where: { id: live.id },
        data: { status: "withdrawn", tokenHash: null },
      });
      await this.audit.record(
        {
          action: "guardian_consent.withdraw",
          targetType: "user",
          targetId: userId,
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          meta: { consentId: live.id, previousStatus: live.status },
        },
        tx,
      );
      return { status: "withdrawn" as const };
    });
  }
}
