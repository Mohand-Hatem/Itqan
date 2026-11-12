import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import { AccessReasonCode, type StudentAccessPatch } from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

type Tx = Pick<ScopedPrismaClient, "$queryRaw" | "membership">;

/**
 * Staff actions on a student's access (docs/05-auth-devices.md §7, step 5.9). Every action finds
 * the student through a membership in this tenant (tenant-scoped, so other tenants → 404), takes
 * the student's user-row lock (same as login), and writes its audit entry in the same transaction.
 */
@Injectable()
export class StudentsAccessService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Revoke a device: it can no longer sign in, and its sessions end at once. */
  revokeDevice(deviceId: string, actorUserId: string) {
    return this.db.$transaction(async (tx) => {
      const device = await tx.device.findUnique({
        where: { id: deviceId },
        select: { userId: true },
      });
      // Devices are global; only a student of this tenant makes the device reachable here.
      const membership = device
        ? await tx.membership.findFirst({
            where: { userId: device.userId, role: "student" },
            select: { id: true },
          })
        : null;
      if (!device || !membership) throw new NotFoundException();
      await this.lockUser(tx, device.userId);

      const current = await tx.device.findUniqueOrThrow({
        where: { id: deviceId },
        select: { status: true },
      });
      if (current.status !== "revoked") {
        await tx.device.update({
          where: { id: deviceId },
          data: { status: "revoked", revokedAt: new Date() },
        });
        const { count } = await tx.session.deleteMany({ where: { deviceId } });
        await this.audit.record(
          {
            action: "device.revoke",
            targetType: "device",
            targetId: deviceId,
            actorUserId,
            meta: { membershipId: membership.id, sessionsEnded: count },
          },
          tx,
        );
      }
      return { id: deviceId, status: "revoked" as const };
    });
  }

  /** End every session of the student, on any tenant. Devices stay registered. */
  forceSignOut(membershipId: string, actorUserId: string) {
    return this.db.$transaction(async (tx) => {
      const student = await this.lockStudent(tx, membershipId);
      const { count } = await tx.session.deleteMany({ where: { userId: student.userId } });
      await this.audit.record(
        {
          action: "student.force_signout",
          targetType: "membership",
          targetId: membershipId,
          actorUserId,
          meta: { sessionsEnded: count },
        },
        tx,
      );
      return { membershipId, sessionsEnded: count };
    });
  }

  /**
   * Suspend or reactivate the membership, and/or change max_devices.
   * Suspending ends the student's sessions on this tenant only. Lowering max_devices never
   * revokes devices; staff revoke extras by hand.
   */
  update(
    membershipId: string,
    patch: StudentAccessPatch,
    actor: { userId: string; mayChangeMaxDevices: boolean },
  ) {
    if (patch.maxDevices !== undefined && !actor.mayChangeMaxDevices) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AccessReasonCode.ROLE_FORBIDDEN,
        message: "Only the teacher can change the number of devices.",
      });
    }
    const context = getRequestContext();
    if (context?.kind !== "tenant") throw new NotFoundException();

    return this.db.$transaction(async (tx) => {
      const student = await this.lockStudent(tx, membershipId);
      const record = (action: string, meta: Record<string, unknown> = {}) =>
        this.audit.record(
          {
            action,
            targetType: "membership",
            targetId: membershipId,
            actorUserId: actor.userId,
            meta,
          },
          tx,
        );

      let status = student.status;
      if (patch.status && patch.status !== student.status) {
        status = patch.status;
        await tx.membership.update({ where: { id: membershipId }, data: { status } });
        if (status === "suspended") {
          // Session is a global table, so the tenant filter is written by hand.
          const { count } = await tx.session.deleteMany({
            where: { userId: student.userId, tenantId: context.tenantId },
          });
          await record("student.suspend", { sessionsEnded: count });
        } else {
          await record("student.reactivate");
        }
      }

      const { maxDevices: from } = await tx.user.findUniqueOrThrow({
        where: { id: student.userId },
        select: { maxDevices: true },
      });
      let maxDevices = from;
      if (patch.maxDevices !== undefined && patch.maxDevices !== from) {
        maxDevices = patch.maxDevices;
        await tx.user.update({ where: { id: student.userId }, data: { maxDevices } });
        await record("student.max_devices", { from, to: maxDevices });
      }

      return { membershipId, status, maxDevices };
    });
  }

  /** A student membership of this tenant (404 for other tenants and for staff), user row locked. */
  private async lockStudent(tx: Tx, membershipId: string) {
    const membership = await tx.membership.findUnique({
      where: { id: membershipId },
      select: { userId: true, role: true, status: true },
    });
    if (membership?.role !== "student") throw new NotFoundException();
    await this.lockUser(tx, membership.userId);
    return membership;
  }

  private async lockUser(tx: Pick<ScopedPrismaClient, "$queryRaw">, userId: string) {
    // users is a global table, so this raw query needs no tenant filter.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }
}
