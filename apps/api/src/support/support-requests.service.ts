import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import {
  type Auth,
  type AuthUser,
  checkStudentAccess,
  createDeviceSecret,
  formatDeviceCookie,
  hashDeviceSecret,
  readDeviceCookie,
  verifyCredentials,
  verifyDeviceSecret,
} from "@itqan/auth";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import {
  AccessReasonCode,
  type CreateGeneralSupportRequestDto,
  type DeviceRequestBody,
  type SignOutRequestBody,
  type SupportRequestListQuery,
  SupportRequestReason,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { AUTH_INSTANCE } from "../auth/session.guard.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { deviceRequestDecidedNotification } from "../notifications/notification-inputs.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { SseService } from "../notifications/sse.service.js";

export type SupportRequestResult = { requestId: string; status: "open" };

export type DeviceRequestResult = SupportRequestResult & {
  /** Set only when a new pending device was created; the controller sends it as the device cookie. */
  deviceCookie: string | null;
};

type Credentials = { email: string; password: string };
type PresentedDevice = ReturnType<typeof readDeviceCookie>;
type LockingTx = Pick<ScopedPrismaClient, "$queryRaw" | "user" | "device">;
type DecisionTx = Pick<ScopedPrismaClient, "$queryRaw" | "supportRequest">;

const conflict = (reason: string, message: string) =>
  new ConflictException({ statusCode: 409, reason, message });

@Injectable()
export class SupportRequestsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(SseService) private readonly sseService?: SseService,
    @Optional()
    @Inject(NotificationsService)
    private readonly notificationsService?: NotificationsService,
  ) {}

  /** Staff list (step 5.8a): newest first; uuidv7 ids sort by creation time. */
  async list(query: SupportRequestListQuery) {
    const rows = await this.db.supportRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: query.limit + 1,
      select: {
        id: true,
        type: true,
        status: true,
        message: true,
        response: true,
        createdAt: true,
        decidedAt: true,
        membership: { select: { id: true, user: { select: { name: true, email: true } } } },
        pendingDevice: { select: { id: true, userAgent: true, createdAt: true } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(({ membership, ...row }) => ({
        ...row,
        student: { membershipId: membership.id, ...membership.user },
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  /** Student self-service list (step 9.8a): only own requests. */
  async listOwn(userId: string, query: SupportRequestListQuery) {
    const rows = await this.db.supportRequest.findMany({
      where: {
        membership: { userId },
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: "desc" },
      take: query.limit + 1,
      select: {
        id: true,
        type: true,
        status: true,
        message: true,
        response: true,
        createdAt: true,
        decidedAt: true,
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page,
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  /** Student opens a general support request (step 9.8a, FR-N05). */
  async createGeneral(user: AuthUser, body: CreateGeneralSupportRequestDto) {
    const context = getRequestContext();
    if (context?.kind !== "tenant") throw new NotFoundException();

    const membership = await this.db.membership.findFirst({
      where: { tenantId: context.tenantId, userId: user.id },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "MEMBERSHIP_REQUIRED",
        message: "Active tenant membership required.",
      });
    }

    const created = await this.db.supportRequest.create({
      data: {
        tenantId: context.tenantId,
        membershipId: membership.id,
        type: "general",
        status: "open",
        message: body.message,
      },
      select: {
        id: true,
        type: true,
        status: true,
        message: true,
        createdAt: true,
      },
    });

    await this.audit.record({
      action: "support_request.create",
      targetType: "support_request",
      targetId: created.id,
      actorUserId: user.id,
      meta: { type: "general" },
    });

    return created;
  }

  /** Staff answers and closes a support request (step 9.8a, FR-N05). */
  async close(id: string, actorUserId: string, responseMessage?: string) {
    return this.db.$transaction(async (tx) => {
      const request = await tx.supportRequest.findUnique({
        where: { id },
        select: {
          id: true,
          type: true,
          status: true,
          membership: { select: { userId: true } },
        },
      });
      if (!request) throw new NotFoundException();
      if (request.status !== "open") {
        throw conflict(SupportRequestReason.REQUEST_NOT_OPEN, "This request was already decided.");
      }
      const now = new Date();
      const updated = await tx.supportRequest.update({
        where: { id },
        data: {
          status: "closed",
          response: responseMessage || null,
          decidedById: actorUserId,
          decidedAt: now,
        },
        select: {
          id: true,
          status: true,
          response: true,
          decidedAt: true,
        },
      });
      await this.audit.record(
        {
          action: "support_request.close",
          targetType: "support_request",
          targetId: id,
          actorUserId,
          meta: { type: request.type, hasResponse: Boolean(responseMessage) },
        },
        tx,
      );
      return {
        ...updated,
        studentUserId: request.membership.userId,
      };
    }).then(async (res) => {
      if (this.notificationsService) {
        await this.notificationsService
          .create({
            userId: res.studentUserId,
            type: "support_request_decided",
            title: "Support request updated",
            body: res.response ?? "Your support request has been closed.",
            data: { requestId: res.id, status: res.status },
          })
          .catch(() => {
            // non-blocking
          });
      }
      return {
        id: res.id,
        status: res.status,
        response: res.response,
        decidedAt: res.decidedAt,
      };
    });
  }

  /**
   * docs/05 §5–6, step 5.8a. device_change: revoke just enough active devices (least recently
   * used first) to make room, end their sessions, activate the pending device.
   * sign_out_other: end all of the student's sessions; devices stay registered.
   */
  async approve(id: string, actorUserId: string) {
    return this.db.$transaction(async (tx) => {
      const request = await this.lockOpenRequest(tx, id);
      const now = new Date();
      let revokedDeviceIds: string[] = [];

      if (request.type === "device_change") {
        const pending = request.pendingDeviceId
          ? await tx.device.findUnique({ where: { id: request.pendingDeviceId } })
          : null;
        if (pending?.status !== "pending") {
          throw conflict(
            SupportRequestReason.REQUEST_STALE,
            "The browser that asked is no longer waiting. Ask the student to request again.",
          );
        }
        const { maxDevices } = await tx.user.findUniqueOrThrow({
          where: { id: request.userId },
          select: { maxDevices: true },
        });
        const active = await tx.device.findMany({
          where: { userId: request.userId, status: "active" },
          orderBy: [{ lastSeenAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
          select: { id: true },
        });
        revokedDeviceIds = active
          .slice(0, Math.max(0, active.length - maxDevices + 1))
          .map((d) => d.id);
        if (revokedDeviceIds.length > 0) {
          await tx.device.updateMany({
            where: { id: { in: revokedDeviceIds } },
            data: { status: "revoked", revokedAt: now },
          });
          await tx.session.deleteMany({ where: { deviceId: { in: revokedDeviceIds } } });
        }
        await tx.device.update({ where: { id: pending.id }, data: { status: "active" } });
      } else if (request.type === "sign_out_other") {
        // Owner decision (5.7): the asking browser is blocked and holds no session, so end them all.
        await tx.session.deleteMany({ where: { userId: request.userId } });
      }

      await this.closeRequest(tx, id, "approved", actorUserId, now);
      await this.audit.record(
        {
          action: "support_request.approve",
          targetType: "support_request",
          targetId: id,
          actorUserId,
          meta: {
            type: request.type,
            revokedDeviceIds,
            activatedDeviceId: request.pendingDeviceId,
          },
        },
        tx,
      );
      const afterCommit = await this.stageDecision(tx, request, id, "approved");
      return {
        id,
        status: "approved" as const,
        userId: request.userId,
        revokedDeviceIds,
        type: request.type,
        afterCommit,
      };
    }).then((res) => {
      res.afterCommit();
      if (res.revokedDeviceIds.length > 0) {
        for (const rId of res.revokedDeviceIds) {
          const event = { deviceId: rId, revokedAt: new Date().toISOString() };
          this.sseService?.closeStreams(
            res.userId,
            { event: "device_revoked", data: event },
            { deviceId: rId },
          );
          this.sseService?.emitControlEvent(res.userId, "device_revoked", event);
        }
      } else if (res.type === "sign_out_other") {
        this.sseService?.closeStreams(res.userId, {
          event: "session_terminated",
          data: { reason: "SIGN_OUT_OTHER_APPROVED" },
        });
      }
      return { id: res.id, status: res.status };
    });
  }

  /** Step 5.8a: reject; a device_change's pending device is revoked so its cookie is dead. */
  async reject(id: string, actorUserId: string) {
    return this.db.$transaction(async (tx) => {
      const request = await this.lockOpenRequest(tx, id);
      const now = new Date();
      if (request.type === "device_change" && request.pendingDeviceId) {
        await tx.device.updateMany({
          where: { id: request.pendingDeviceId, status: "pending" },
          data: { status: "revoked", revokedAt: now },
        });
      }
      await this.closeRequest(tx, id, "rejected", actorUserId, now);
      await this.audit.record(
        {
          action: "support_request.reject",
          targetType: "support_request",
          targetId: id,
          actorUserId,
          meta: { type: request.type },
        },
        tx,
      );
      const afterCommit = await this.stageDecision(tx, request, id, "rejected");
      return { id, status: "rejected" as const, afterCommit };
    }).then(({ afterCommit, ...res }) => {
      afterCommit();
      return res;
    });
  }

  /** FR-N03: the student is told (bell, SSE, email) when a device request is decided. */
  private async stageDecision(
    tx: Parameters<NotificationsService["stage"]>[0],
    request: { type: string; userId: string },
    id: string,
    status: "approved" | "rejected",
  ): Promise<() => void> {
    if (!this.notificationsService) return () => {};
    if (request.type !== "device_change" && request.type !== "sign_out_other") return () => {};
    return this.notificationsService.stage(tx, [
      deviceRequestDecidedNotification(request.userId, { id, type: request.type, status }),
    ]);
  }

  /**
   * docs/05-auth-devices.md §5: a student blocked with DEVICE_LIMIT asks to switch to this browser.
   * Creates a pending device bound to this browser and an open device_change request.
   */
  async requestDeviceChange(
    body: DeviceRequestBody,
    origin: { cookieHeader?: string; userAgent?: string },
  ): Promise<DeviceRequestResult> {
    const { tenantId, userId, membershipId } = await this.authenticateStudent(body);
    const presented = readDeviceCookie(origin.cookieHeader);

    return this.db.$transaction(async (tx) => {
      const { maxDevices, devices, thisBrowser } = await this.lockAndLoadDevices(
        tx,
        userId,
        presented,
      );

      const open = await tx.supportRequest.findFirst({
        where: { membershipId, type: "device_change", status: "open" },
        select: { id: true, pendingDeviceId: true },
      });
      if (open) {
        if (thisBrowser && open.pendingDeviceId === thisBrowser.id) {
          return { requestId: open.id, status: "open" as const, deviceCookie: null };
        }
        throw conflict(
          SupportRequestReason.REQUEST_ALREADY_OPEN,
          "A device change request is already waiting for staff.",
        );
      }

      const active = devices.filter((d) => d.status === "active").length;
      if (thisBrowser?.status === "active" || active < maxDevices) {
        throw conflict(
          SupportRequestReason.DEVICE_REQUEST_NOT_NEEDED,
          "This browser can sign in without a request.",
        );
      }

      const secret = createDeviceSecret();
      const device = await tx.device.create({
        data: {
          userId,
          status: "pending",
          secretHash: hashDeviceSecret(secret),
          userAgent: origin.userAgent ?? null,
        },
        select: { id: true },
      });
      // tenantId comes from the request context (the Host header), never from the body;
      // the tenant extension rejects any other value.
      const request = await tx.supportRequest.create({
        data: {
          tenantId,
          membershipId,
          type: "device_change",
          message: body.message || null,
          pendingDeviceId: device.id,
        },
        select: { id: true },
      });
      return {
        requestId: request.id,
        status: "open" as const,
        deviceCookie: formatDeviceCookie(device.id, secret),
      };
    });
  }

  /**
   * docs/05-auth-devices.md §6: a student blocked with SESSION_ON_OTHER_DEVICE asks staff to end
   * the sessions on the other device. Takes nothing for this browser (no device, no cookie).
   */
  async requestSignOutOther(
    body: SignOutRequestBody,
    origin: { cookieHeader?: string },
  ): Promise<SupportRequestResult> {
    const { tenantId, userId, membershipId } = await this.authenticateStudent(body);
    const presented = readDeviceCookie(origin.cookieHeader);

    return this.db.$transaction(async (tx) => {
      const { maxDevices, devices, thisBrowser } = await this.lockAndLoadDevices(
        tx,
        userId,
        presented,
      );

      const open = await tx.supportRequest.findFirst({
        where: { membershipId, type: "sign_out_other", status: "open" },
        select: { id: true },
      });
      if (open) return { requestId: open.id, status: "open" as const };

      // Valid only if it would unblock this browser: a login here must pass the device limit…
      const ownDevice = thisBrowser?.status === "active" ? thisBrowser : undefined;
      const active = devices.filter((d) => d.status === "active").length;
      if (!ownDevice && active >= maxDevices) {
        throw conflict(
          AccessReasonCode.DEVICE_LIMIT,
          "This account is linked to another device. Request a device change instead.",
        );
      }
      // …and then be blocked by an open session on another device, on any tenant.
      const otherSession = await tx.session.findFirst({
        where: {
          userId,
          expiresAt: { gt: new Date() },
          AND: [
            { deviceId: { not: null } },
            ...(ownDevice ? [{ deviceId: { not: ownDevice.id } }] : []),
          ],
        },
        select: { id: true },
      });
      if (!otherSession) {
        throw conflict(
          SupportRequestReason.SIGN_OUT_REQUEST_NOT_NEEDED,
          "No other device is signed in.",
        );
      }

      const request = await tx.supportRequest.create({
        data: { tenantId, membershipId, type: "sign_out_other", message: body.message || null },
        select: { id: true },
      });
      return { requestId: request.id, status: "open" as const };
    });
  }

  /**
   * Finds the request in this tenant (404 otherwise), takes the student's user-row lock (same as
   * login) and checks it is still open after the lock, so two staff clicks cannot both decide it.
   */
  private async lockOpenRequest(tx: DecisionTx, id: string) {
    const found = await tx.supportRequest.findUnique({
      where: { id },
      select: { type: true, pendingDeviceId: true, membership: { select: { userId: true } } },
    });
    if (!found) throw new NotFoundException();
    const userId = found.membership.userId;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const current = await tx.supportRequest.findUnique({ where: { id }, select: { status: true } });
    if (current?.status !== "open") {
      throw conflict(SupportRequestReason.REQUEST_NOT_OPEN, "This request was already decided.");
    }
    return { type: found.type, pendingDeviceId: found.pendingDeviceId, userId };
  }

  private async closeRequest(
    tx: DecisionTx,
    id: string,
    status: "approved" | "rejected",
    actorUserId: string,
    now: Date,
  ) {
    await tx.supportRequest.update({
      where: { id },
      data: { status, decidedById: actorUserId, decidedAt: now },
    });
  }

  /** Shared start of every student request: tenant from Host, password, student access checks. */
  private async authenticateStudent(body: Credentials) {
    const context = getRequestContext();
    if (context?.kind !== "tenant") throw new NotFoundException();

    const user = await verifyCredentials(await this.auth.$context, body.email, body.password);
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        reason: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
      });
    }
    if (!user.emailVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "EMAIL_NOT_VERIFIED",
        message: "Email not verified",
      });
    }
    const access = await checkStudentAccess(user.id, context.tenantId);
    if (!access.ok) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: access.code,
        message: access.message,
      });
    }
    return { tenantId: context.tenantId, userId: user.id, membershipId: access.membershipId };
  }

  /** Takes the same user-row lock as login (step 5.3), then loads the devices that count. */
  private async lockAndLoadDevices(tx: LockingTx, userId: string, presented: PresentedDevice) {
    // users is a global table, so this raw query needs no tenant filter.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const { maxDevices } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { maxDevices: true },
    });
    const devices = await tx.device.findMany({
      where: { userId, status: { in: ["active", "pending"] } },
      select: { id: true, status: true, secretHash: true },
    });
    const thisBrowser = presented
      ? devices.find(
          (d) => d.id === presented.deviceId && verifyDeviceSecret(presented.secret, d.secretHash),
        )
      : undefined;
    return { maxDevices, devices, thisBrowser };
  }
}
