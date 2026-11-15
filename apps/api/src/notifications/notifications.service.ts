import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import * as auth from "@itqan/auth";
import type { EmailLocale } from "@itqan/auth";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import type {
  ListNotificationsQueryDto,
  ListNotificationsResponseDto,
  MarkNotificationsReadResponseDto,
} from "@itqan/shared";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { SseService } from "./sse.service.js";

export type NotificationEmailOptions = {
  to?: string;
  studentName?: string;
  tenantName?: string;
  locale?: EmailLocale;
  quizTitle?: string;
  courseTitle?: string;
  score?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  passed?: boolean | null;
  reviewUrl?: string;
  opensAt?: Date | string;
  closesAt?: Date | string;
  durationMin?: number;
  examUrl?: string;
  courseUrl?: string;
  status?: "approved" | "rejected";
  requestType?: "device_change" | "sign_out_other";
  loginUrl?: string;
};

export type CreateNotificationInput = {
  tenantId?: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sendEmail?: boolean;
  emailOptions?: NotificationEmailOptions;
};

export type NotificationWriter = {
  notification: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (args: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createMany?: (args: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createManyAndReturn?: (args: any) => Promise<any[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany?: (args: any) => Promise<any>;
  };
};

export type PostCommitCallback = () => Promise<void> | void;

/**
 * Gap between emails of one batch. Resend allows about 2 requests a second by default, so a
 * grade release to hundreds of students goes out paced in the background (step 10.1).
 */
export const EMAIL_SEND_GAP_MS = 600;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Optional() private readonly sseService?: SseService,
  ) {}

  /**
   * Persist a single notification row, optionally within an existing transaction.
   * If sendEmail is true and registerPostCommit is supplied, hooks up post-commit dispatch.
   */
  async create(
    input: CreateNotificationInput,
    tx?: NotificationWriter,
    registerPostCommit?: (cb: PostCommitCallback) => void,
  ) {
    const context = getRequestContext();
    const tenantId =
      input.tenantId ?? (context?.kind === "tenant" ? context.tenantId : undefined);

    if (!tenantId) {
      throw new Error("Cannot create notification without tenant context.");
    }

    const client = tx ? tx.notification : this.db.notification;
    const row = await client.create({
      data: {
        tenantId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as object,
      },
    });

    // Inside a transaction the push waits for commit, so nobody sees a row that rolls back.
    if (!tx) this.emitCreated(row);
    else registerPostCommit?.(() => this.emitCreated(row));

    if (input.sendEmail) {
      const emailPayload = {
        userId: input.userId,
        tenantId,
        type: input.type,
        title: input.title,
        data: input.data,
        emailOptions: input.emailOptions,
      };

      if (registerPostCommit) {
        registerPostCommit(async () => {
          await this.dispatchEmail(emailPayload);
        });
      } else if (!tx) {
        await this.dispatchEmail(emailPayload);
      }
    }

    return row;
  }

  /**
   * Write notification rows inside the caller's transaction (FR-N01, one query) and return a
   * function to call after commit. It pushes each row over SSE and sends the emails in the
   * background, so a grade release to many students does not hold the request open.
   */
  async stage(
    tx: NotificationWriter,
    inputs: CreateNotificationInput[],
  ): Promise<() => void> {
    if (inputs.length === 0) return () => {};
    const context = getRequestContext();
    const contextTenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    const data = inputs.map((input) => {
      const tenantId = input.tenantId ?? contextTenantId;
      if (!tenantId) throw new Error("Cannot create notification without tenant context.");
      return {
        tenantId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: (input.data ?? {}) as object,
      };
    });
    const rows = await tx.notification.createManyAndReturn!({ data });

    return () => {
      for (const row of rows) this.emitCreated(row);
      const emails = inputs.filter((input) => input.sendEmail);
      if (emails.length === 0) return;
      void (async () => {
        let first = true;
        for (const [i, input] of inputs.entries()) {
          if (!input.sendEmail) continue;
          if (!first) await new Promise((r) => setTimeout(r, EMAIL_SEND_GAP_MS));
          first = false;
          await this.dispatchEmail({
            userId: input.userId,
            tenantId: data[i]!.tenantId,
            type: input.type,
            title: input.title,
            data: input.data,
            emailOptions: input.emailOptions,
          });
        }
      })();
    };
  }

  /** Same as stage() for callers with no transaction of their own. */
  async notify(inputs: CreateNotificationInput[]): Promise<void> {
    const afterCommit = await this.stage(this.db, inputs);
    afterCommit();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private emitCreated(row: any): void {
    this.sseService?.emitToUser(
      row.userId,
      {
        event: "notification.created",
        data: {
          id: row.id,
          type: row.type,
          title: row.title,
          body: row.body,
          data: row.data,
          readAt: row.readAt,
          createdAt: row.createdAt,
        },
      },
      row.tenantId,
    );
  }

  /**
   * Dispatches email notification for important notification types.
   * Catches all delivery and network errors to prevent side-effect failures.
   */
  async dispatchEmail(input: {
    userId: string;
    tenantId?: string;
    type: string;
    title?: string;
    data?: Record<string, unknown>;
    emailOptions?: NotificationEmailOptions;
  }): Promise<{ id?: string; error?: string; skipped?: boolean }> {
    try {
      const { userId, type, data, emailOptions } = input;
      const context = getRequestContext();
      const tenantId =
        input.tenantId ?? (context?.kind === "tenant" ? context.tenantId : undefined);

      let to = emailOptions?.to;
      let studentName = emailOptions?.studentName;

      if (!to || !studentName) {
        const user = await this.db.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true },
        });
        if (!user || !user.email) {
          this.logger.warn(`Cannot send notification email: User ${userId} has no email address`);
          return { error: "User has no email address" };
        }
        to = to ?? user.email;
        studentName = studentName ?? user.name;
      }

      let tenantName = emailOptions?.tenantName;
      if (!tenantName && tenantId) {
        const tenant = await this.db.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        });
        tenantName = tenant?.name ?? "Itqan";
      } else {
        tenantName = tenantName ?? "Itqan";
      }

      const locale = emailOptions?.locale ?? ((data?.["locale"] as EmailLocale) || "ar");

      switch (type) {
        case "grade_released": {
          const quizTitle =
            emailOptions?.quizTitle ??
            (data?.["quizTitle"] as string) ??
            input.title ??
            "الدرجات";
          const res = await auth.sendGradeReleasedEmail({
            to,
            studentName,
            quizTitle,
            courseTitle: emailOptions?.courseTitle ?? (data?.["courseTitle"] as string),
            score: emailOptions?.score ?? (data?.["score"] as number),
            maxScore: emailOptions?.maxScore ?? (data?.["maxScore"] as number),
            percentage: emailOptions?.percentage ?? (data?.["percentage"] as number),
            passed: emailOptions?.passed ?? (data?.["passed"] as boolean),
            reviewUrl: emailOptions?.reviewUrl ?? (data?.["reviewUrl"] as string),
            tenantName,
            locale,
          });
          return res;
        }

        case "exam_opening": {
          const quizTitle =
            emailOptions?.quizTitle ??
            (data?.["quizTitle"] as string) ??
            input.title ??
            "الاختبار";
          const res = await auth.sendExamOpeningEmail({
            to,
            studentName,
            quizTitle,
            courseTitle: emailOptions?.courseTitle ?? (data?.["courseTitle"] as string),
            opensAt: emailOptions?.opensAt ?? (data?.["opensAt"] as string),
            closesAt: emailOptions?.closesAt ?? (data?.["closesAt"] as string),
            durationMin: emailOptions?.durationMin ?? (data?.["durationMin"] as number),
            examUrl: emailOptions?.examUrl ?? (data?.["examUrl"] as string),
            tenantName,
            locale,
          });
          return res;
        }

        case "course_access": {
          const courseTitle =
            emailOptions?.courseTitle ??
            (data?.["courseTitle"] as string) ??
            input.title ??
            "الدورة";
          const res = await auth.sendCourseAccessEmail({
            to,
            studentName,
            courseTitle,
            courseUrl: emailOptions?.courseUrl ?? (data?.["courseUrl"] as string),
            tenantName,
            locale,
          });
          return res;
        }

        case "device_request_decided": {
          const status =
            emailOptions?.status ??
            (data?.["status"] as "approved" | "rejected") ??
            "approved";
          const requestType =
            emailOptions?.requestType ??
            (data?.["requestType"] as "device_change" | "sign_out_other") ??
            "device_change";
          const res = await auth.sendDeviceRequestDecidedEmail({
            to,
            studentName,
            status,
            requestType,
            tenantName,
            loginUrl: emailOptions?.loginUrl ?? (data?.["loginUrl"] as string),
            locale,
          });
          return res;
        }

        default:
          return { skipped: true };
      }
    } catch (err) {
      this.logger.error(
        `Failed to dispatch email for notification ${input.type} to user ${input.userId}`,
        err,
      );
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Executes operations within a database transaction, collecting post-commit callbacks.
   * Registered callbacks run strictly after the transaction commits.
   * If the transaction rolls back or throws, registered callbacks are discarded and never run.
   */
  async withTransaction<T>(
    fn: (
      tx: ScopedPrismaClient,
      postCommit: (callback: PostCommitCallback) => void,
    ) => Promise<T>,
  ): Promise<T> {
    const postCommitCallbacks: PostCommitCallback[] = [];
    const registerPostCommit = (cb: PostCommitCallback) => {
      postCommitCallbacks.push(cb);
    };

    const result = await this.db.$transaction(async (tx) => {
      return await fn(tx as unknown as ScopedPrismaClient, registerPostCommit);
    });

    // Execute post-commit callbacks safely after commit
    for (const callback of postCommitCallbacks) {
      try {
        await callback();
      } catch (err) {
        this.logger.error("Error executing post-commit notification callback", err);
      }
    }

    return result;
  }

  /**
   * List notifications for a user, newest first, with unreadCount and cursor pagination.
   */
  async list(userId: string, query: ListNotificationsQueryDto): Promise<ListNotificationsResponseDto> {
    const limit = query.limit ?? 20;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    if (query.cursor) {
      const cursorRecord = await this.db.notification.findUnique({
        where: { id: query.cursor },
        select: { id: true, createdAt: true },
      });
      if (cursorRecord) {
        where.OR = [
          { createdAt: { lt: cursorRecord.createdAt } },
          { createdAt: cursorRecord.createdAt, id: { lt: cursorRecord.id } },
        ];
      }
    }

    const [items, unreadCount] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      }),
      this.db.notification.count({
        where: { userId, readAt: null },
      }),
    ]);

    let nextCursor: string | null = null;
    if (items.length > limit) {
      const nextItem = items.pop()!;
      nextCursor = nextItem.id;
    }

    return {
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        body: item.body,
        data: (item.data ?? {}) as Record<string, unknown>,
        readAt: item.readAt,
        createdAt: item.createdAt,
      })),
      unreadCount,
      nextCursor,
    };
  }

  /**
   * Get unread count for a user in the current tenant.
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.db.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Mark notifications as read. If ids are provided, marks those specific IDs.
   * If ids are omitted or empty, marks all unread notifications for this user as read.
   */
  async markRead(userId: string, ids?: string[]): Promise<MarkNotificationsReadResponseDto> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      userId,
      readAt: null,
    };

    if (ids && ids.length > 0) {
      where.id = { in: ids };
    }

    const res = await this.db.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });

    return { updatedCount: res.count };
  }
}
