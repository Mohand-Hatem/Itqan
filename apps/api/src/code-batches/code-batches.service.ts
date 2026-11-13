import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import type {
  CodeBatchCodesQueryInput,
  CodeBatchCreateInput,
  CodeBatchListQueryInput,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { generateCrockfordCode, hashAccessCode, type GeneratedCode } from "./crypto.js";

@Injectable()
export class CodeBatchesService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(input: CodeBatchCreateInput, actorUserId: string) {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "Tenant context is required.",
      });
    }

    const course = await this.db.course.findUnique({
      where: { id: input.courseId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!course) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "INVALID_COURSE",
        message: "Selected course does not exist or has been deleted.",
      });
    }

    // Generate N unique Crockford Base32 codes in memory
    const generatedCodes: Array<GeneratedCode & { serialNumber: number; codeHash: string }> = [];
    const seenRaws = new Set<string>();

    for (let i = 1; i <= input.count; i++) {
      let code = generateCrockfordCode();
      while (seenRaws.has(code.raw)) {
        code = generateCrockfordCode();
      }
      seenRaws.add(code.raw);

      const codeHash = hashAccessCode(code.raw);
      generatedCodes.push({
        ...code,
        serialNumber: i,
        codeHash,
      });
    }

    const result = await this.db.$transaction(async (tx) => {
      const batch = await tx.accessCodeBatch.create({
        data: {
          tenantId,
          courseId: input.courseId,
          name: input.name ?? null,
          codeCount: input.count,
          createdById: actorUserId,
        },
      });

      await tx.accessCode.createMany({
        data: generatedCodes.map((c) => ({
          tenantId,
          batchId: batch.id,
          courseId: input.courseId,
          serialNumber: c.serialNumber,
          codeHash: c.codeHash,
          codePrefix: c.prefix,
        })),
      });

      await this.audit.record(
        {
          action: "code_batch.create",
          targetType: "code_batch",
          targetId: batch.id,
          actorUserId,
          meta: {
            courseId: input.courseId,
            count: input.count,
            name: input.name ?? null,
          },
        },
        tx,
      );

      return batch;
    });

    // Format single-use CSV output
    const csvHeader = "Serial,Code,FormattedCode,CourseTitle,BatchId,CreatedAt\n";
    const csvRows = generatedCodes
      .map(
        (c) =>
          `${c.serialNumber},${c.raw},${c.formatted},"${course.title.replace(/"/g, '""')}",${result.id},${result.createdAt.toISOString()}`,
      )
      .join("\n");
    const csv = csvHeader + csvRows;

    return {
      batch: {
        id: result.id,
        courseId: result.courseId,
        courseTitle: course.title,
        name: result.name,
        codeCount: result.codeCount,
        redeemedCount: result.redeemedCount,
        revokedAt: result.revokedAt,
        createdAt: result.createdAt,
      },
      csv,
      codes: generatedCodes.map((c) => ({
        serial: c.serialNumber,
        code: c.formatted,
      })),
    };
  }

  async list(query: CodeBatchListQueryInput) {
    let statusFilter = {};
    if (query.status === "active") {
      statusFilter = { revokedAt: null };
    } else if (query.status === "revoked") {
      statusFilter = { revokedAt: { not: null } };
    }

    const rows = await this.db.accessCodeBatch
      .findMany({
        where: {
          ...(query.courseId ? { courseId: query.courseId } : {}),
          ...statusFilter,
        },
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        include: {
          course: { select: { title: true } },
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
      items: page.map((b) => ({
        id: b.id,
        courseId: b.courseId,
        courseTitle: b.course.title,
        name: b.name,
        codeCount: b.codeCount,
        redeemedCount: b.redeemedCount,
        isRevoked: Boolean(b.revokedAt),
        createdAt: b.createdAt,
        revokedAt: b.revokedAt,
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  async listCodes(batchId: string, query: CodeBatchCodesQueryInput) {
    const batch = await this.db.accessCodeBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "BATCH_NOT_FOUND",
        message: "Access code batch not found.",
      });
    }

    let statusFilter = {};
    if (query.status === "unredeemed") {
      statusFilter = { redeemedAt: null, revokedAt: null };
    } else if (query.status === "redeemed") {
      statusFilter = { redeemedAt: { not: null } };
    } else if (query.status === "revoked") {
      statusFilter = { revokedAt: { not: null } };
    }

    const rows = await this.db.accessCode
      .findMany({
        where: {
          batchId,
          ...statusFilter,
        },
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        orderBy: [{ serialNumber: "asc" }, { id: "asc" }],
        take: query.limit + 1,
        include: {
          redeemedByUser: { select: { id: true, email: true, name: true } },
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
      batchId,
      items: page.map((c) => ({
        id: c.id,
        serial: c.serialNumber,
        codeMasked: `${c.codePrefix}-••••-••••`,
        status: c.redeemedAt ? "redeemed" : c.revokedAt ? "revoked" : "unredeemed",
        redeemedAt: c.redeemedAt,
        redeemedBy: c.redeemedByUser
          ? {
              id: c.redeemedByUser.id,
              email: c.redeemedByUser.email,
              name: c.redeemedByUser.name,
            }
          : null,
      })),
      nextCursor: rows.length > query.limit ? page.at(-1)!.id : null,
    };
  }

  async revoke(id: string, actorUserId: string) {
    const existing = await this.db.accessCodeBatch.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "BATCH_NOT_FOUND",
        message: "Access code batch not found.",
      });
    }

    if (existing.revokedAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: "BATCH_ALREADY_REVOKED",
        message: "This batch has already been revoked.",
      });
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.accessCodeBatch.update({
        where: { id },
        data: {
          revokedAt: new Date(),
          revokedById: actorUserId,
        },
      });

      const { count: revokedCodesCount } = await tx.accessCode.updateMany({
        where: {
          batchId: id,
          redeemedAt: null,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      const preservedEnrollmentsCount = await tx.accessCode.count({
        where: {
          batchId: id,
          redeemedAt: { not: null },
        },
      });

      await this.audit.record(
        {
          action: "code_batch.revoke",
          targetType: "code_batch",
          targetId: id,
          actorUserId,
          meta: {
            revokedCount: revokedCodesCount,
            preservedEnrollmentsCount,
          },
        },
        tx,
      );

      return {
        id: updated.id,
        status: "revoked",
        revokedCodesCount,
        preservedEnrollmentsCount,
        revokedAt: updated.revokedAt,
      };
    });
  }
}
