import { Inject, Injectable } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
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

  // Newest first, current tenant only. Filters by actor, action and date arrive with step 9.10.
  list({ limit = 50, cursor }: { limit?: number; cursor?: string } = {}) {
    return this.db.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(Math.max(limit, 1), 100),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
