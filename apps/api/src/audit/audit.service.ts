import { Inject, Injectable } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import type { AuditLogListQueryDto, AuditLogListResponseDto } from "@itqan/shared";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { redact } from "./redact.js";

export type AuditEntry = {
  /** Dotted verb, e.g. "device.revoke", "enrollment.terminate". */
  action: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
  // Passed in until login exists; step 4.7 takes it from the session.
  actorUserId?: string;
  tenantId?: string | null;
};

// Anything with the audit delegate: the scoped client or a transaction client from it.
export type AuditWriter = {
  auditLog: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (args: { data: any }) => Promise<any>;
  };
};

@Injectable()
export class AuditService {
  constructor(@Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient) {}

  // Pass `tx` to write inside the caller's transaction, so the action and its
  // audit entry succeed or fail together. Insert-only: there is no update or delete.
  record(entry: AuditEntry, tx: AuditWriter = this.db) {
    const context = getRequestContext();
    return tx.auditLog.create({
      data: {
        // Tenant comes from entry (if provided) or request context; super admin site records platform actions.
        tenantId:
          entry.tenantId !== undefined
            ? entry.tenantId
            : context?.kind === "tenant"
              ? context.tenantId
              : null,
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        meta: (redact(entry.meta ?? {}) ?? {}) as object,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
      },
    });
  }

  /**
   * Newest first, current tenant only (FR-A01, step 9.10a).
   * Filters by actor, action and date range with keyset cursor pagination.
   */
  async list(query: AuditLogListQueryDto = { limit: 50 }): Promise<AuditLogListResponseDto> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const rows = await this.db.auditLog.findMany({
      where: {
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        tenantId: true,
        action: true,
        targetType: true,
        targetId: true,
        meta: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        actorUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const page = rows.slice(0, limit);
    return {
      items: page.map(({ actorUser, ...r }) => ({
        ...r,
        meta: (r.meta ?? {}) as Record<string, unknown>,
        actor: actorUser,
      })),
      nextCursor: rows.length > limit ? page.at(-1)!.id : null,
    };
  }
}
