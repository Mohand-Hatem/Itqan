import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import {
  QuestionReasonCode,
  type QuestionCreateInput,
  type QuestionQueryInput,
  type QuestionType,
  type QuestionUpdateInput,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

function fail(status: number, reason: string, message: string): never {
  const payload = { statusCode: status, reason, message };
  if (status === 404) throw new NotFoundException(payload);
  throw new BadRequestException(payload);
}

type Tx = Pick<ScopedPrismaClient, "questionBank" | "question" | "questionOption" | "mediaAsset">;

@Injectable()
export class QuestionsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private getTenantId(): string {
    const context = getRequestContext();
    const tenantId = context?.kind === "tenant" ? context.tenantId : undefined;
    if (!tenantId) {
      throw fail(400, "TENANT_REQUIRED", "No tenant context found in request");
    }
    return tenantId;
  }

  private async checkAsset(tx: Tx, assetId: string) {
    const asset = await tx.mediaAsset.findFirst({
      where: { id: assetId, status: "ready" },
      select: { mimeType: true },
    });
    const fits = asset && asset.mimeType.startsWith("image/") && asset.mimeType !== "image/svg+xml";
    if (!fits) {
      throw fail(
        400,
        QuestionReasonCode.ASSET_NOT_USABLE,
        "Image asset must be a ready JPEG, PNG, or WebP image",
      );
    }
  }

  private validateOptions(type: QuestionType, options: { text: string; isCorrect: boolean }[]) {
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (type === "single") {
      if (options.length < 2) {
        throw fail(
          400,
          QuestionReasonCode.INVALID_OPTION_COUNT,
          "Single-choice questions must have at least 2 options",
        );
      }
      if (correctCount !== 1) {
        throw fail(
          400,
          QuestionReasonCode.INVALID_CORRECT_OPTION_COUNT,
          "Single-choice questions must have exactly one correct option",
        );
      }
    } else if (type === "multiple") {
      if (options.length < 2) {
        throw fail(
          400,
          QuestionReasonCode.INVALID_OPTION_COUNT,
          "Multiple-choice questions must have at least 2 options",
        );
      }
      if (correctCount < 1) {
        throw fail(
          400,
          QuestionReasonCode.INVALID_CORRECT_OPTION_COUNT,
          "Multiple-choice questions must have at least one correct option",
        );
      }
    } else if (type === "true_false") {
      if (options.length !== 2) {
        throw fail(
          400,
          QuestionReasonCode.INVALID_OPTION_COUNT,
          "True/False questions must have exactly 2 options",
        );
      }
      if (correctCount !== 1) {
        throw fail(
          400,
          QuestionReasonCode.INVALID_CORRECT_OPTION_COUNT,
          "True/False questions must have exactly one correct option",
        );
      }
    }
  }

  async create(bankId: string, input: QuestionCreateInput, actorUserId: string) {
    const tenantId = this.getTenantId();

    return this.db.$transaction(async (tx) => {
      const bank = await tx.questionBank.findFirst({
        where: { id: bankId, deletedAt: null },
      });
      if (!bank) {
        throw fail(404, QuestionReasonCode.QUESTION_BANK_NOT_FOUND, "Question bank not found");
      }

      if (input.imageAssetId) {
        await this.checkAsset(tx, input.imageAssetId);
      }

      const question = await tx.question.create({
        data: {
          tenantId,
          bankId,
          type: input.type,
          text: input.text,
          imageAssetId: input.imageAssetId ?? null,
          marks: input.marks,
          difficulty: input.difficulty,
          explanation: input.explanation ?? null,
          tags: input.tags,
        },
      });

      await tx.questionOption.createMany({
        data: input.options.map((opt, idx) => ({
          tenantId,
          questionId: question.id,
          text: opt.text,
          isCorrect: opt.isCorrect,
          sortOrder: idx,
        })),
      });

      await this.audit.record(
        {
          action: "question.create",
          targetType: "question",
          targetId: question.id,
          actorUserId,
          meta: { bankId, type: question.type, marks: question.marks },
        },
        tx,
      );

      const options = await tx.questionOption.findMany({
        where: { questionId: question.id },
        orderBy: { sortOrder: "asc" },
      });

      return {
        ...question,
        options,
      };
    });
  }

  async listByBank(bankId: string, query: QuestionQueryInput) {
    const bank = await this.db.questionBank.findFirst({
      where: { id: bankId, deletedAt: null },
    });
    if (!bank) {
      throw fail(404, QuestionReasonCode.QUESTION_BANK_NOT_FOUND, "Question bank not found");
    }

    const limit = query.limit;
    const items = await this.db.question.findMany({
      where: {
        bankId,
        deletedAt: null,
        ...(query.difficulty ? { difficulty: query.difficulty } : {}),
      },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        options: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? resultItems[resultItems.length - 1]?.id : null;

    return {
      items: resultItems,
      nextCursor,
    };
  }

  async getById(id: string) {
    const question = await this.db.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        options: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!question) {
      throw fail(404, QuestionReasonCode.QUESTION_NOT_FOUND, "Question not found");
    }

    return question;
  }

  async update(id: string, input: QuestionUpdateInput, actorUserId: string) {
    const tenantId = this.getTenantId();

    const existing = await this.db.question.findFirst({
      where: { id, deletedAt: null },
      include: {
        options: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!existing) {
      throw fail(404, QuestionReasonCode.QUESTION_NOT_FOUND, "Question not found");
    }

    const targetType = input.type ?? existing.type;
    const targetOptions = input.options ?? existing.options;
    this.validateOptions(targetType, targetOptions);

    return this.db.$transaction(async (tx) => {
      if (input.imageAssetId !== undefined && input.imageAssetId !== null) {
        await this.checkAsset(tx, input.imageAssetId);
      }

      if (input.options) {
        await tx.questionOption.deleteMany({
          where: { questionId: id },
        });

        await tx.questionOption.createMany({
          data: input.options.map((opt, idx) => ({
            tenantId,
            questionId: id,
            text: opt.text,
            isCorrect: opt.isCorrect,
            sortOrder: idx,
          })),
        });
      }

      const updated = await tx.question.update({
        where: { id },
        data: {
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.imageAssetId !== undefined ? { imageAssetId: input.imageAssetId } : {}),
          ...(input.marks !== undefined ? { marks: input.marks } : {}),
          ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
          ...(input.explanation !== undefined ? { explanation: input.explanation } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        },
        include: {
          options: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      await this.audit.record(
        {
          action: "question.update",
          targetType: "question",
          targetId: updated.id,
          actorUserId,
          meta: { type: updated.type, marks: updated.marks },
        },
        tx,
      );

      return updated;
    });
  }

  async delete(id: string, actorUserId: string) {
    const existing = await this.db.question.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw fail(404, QuestionReasonCode.QUESTION_NOT_FOUND, "Question not found");
    }

    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.question.update({
        where: { id },
        data: { deletedAt: now },
      });

      await this.audit.record(
        {
          action: "question.delete",
          targetType: "question",
          targetId: id,
          actorUserId,
          meta: { bankId: existing.bankId },
        },
        tx,
      );

      return {
        id: updated.id,
        deletedAt: updated.deletedAt,
      };
    });
  }
}
