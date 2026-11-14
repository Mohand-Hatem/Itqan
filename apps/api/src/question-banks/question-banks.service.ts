import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import {
  QuestionReasonCode,
  type QuestionBankCreateInput,
  type QuestionBankQueryInput,
  type QuestionBankUpdateInput,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

function fail(status: number, reason: string, message: string): never {
  const payload = { statusCode: status, reason, message };
  if (status === 404) throw new NotFoundException(payload);
  throw new BadRequestException(payload);
}

@Injectable()
export class QuestionBanksService {
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

  async create(input: QuestionBankCreateInput, actorUserId: string) {
    const tenantId = this.getTenantId();

    return this.db.$transaction(async (tx) => {
      if (input.courseId) {
        const course = await tx.course.findFirst({
          where: { id: input.courseId, deletedAt: null },
        });
        if (!course) {
          throw fail(400, QuestionReasonCode.COURSE_NOT_FOUND, "Referenced course was not found");
        }
      }

      const bank = await tx.questionBank.create({
        data: {
          tenantId,
          title: input.title,
          courseId: input.courseId ?? null,
        },
      });

      await this.audit.record(
        {
          action: "question_bank.create",
          targetType: "question_bank",
          targetId: bank.id,
          actorUserId,
          meta: { title: bank.title, courseId: bank.courseId },
        },
        tx,
      );

      return bank;
    });
  }

  async list(query: QuestionBankQueryInput) {
    const limit = query.limit;
    const items = await this.db.questionBank.findMany({
      where: {
        deletedAt: null,
        ...(query.courseId !== undefined ? { courseId: query.courseId } : {}),
      },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        _count: {
          select: {
            questions: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? resultItems[resultItems.length - 1]?.id : null;

    return {
      items: resultItems.map((b) => ({
        id: b.id,
        tenantId: b.tenantId,
        courseId: b.courseId,
        title: b.title,
        questionCount: b._count.questions,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
      })),
      nextCursor,
    };
  }

  async getById(id: string) {
    const bank = await this.db.questionBank.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            questions: {
              where: { deletedAt: null },
            },
          },
        },
      },
    });

    if (!bank) {
      throw fail(404, QuestionReasonCode.QUESTION_BANK_NOT_FOUND, "Question bank not found");
    }

    return {
      id: bank.id,
      tenantId: bank.tenantId,
      courseId: bank.courseId,
      title: bank.title,
      questionCount: bank._count.questions,
      createdAt: bank.createdAt,
      updatedAt: bank.updatedAt,
    };
  }

  async update(id: string, input: QuestionBankUpdateInput, actorUserId: string) {
    const bank = await this.db.questionBank.findFirst({
      where: { id, deletedAt: null },
    });
    if (!bank) {
      throw fail(404, QuestionReasonCode.QUESTION_BANK_NOT_FOUND, "Question bank not found");
    }

    return this.db.$transaction(async (tx) => {
      if (input.courseId !== undefined && input.courseId !== null) {
        const course = await tx.course.findFirst({
          where: { id: input.courseId, deletedAt: null },
        });
        if (!course) {
          throw fail(400, QuestionReasonCode.COURSE_NOT_FOUND, "Referenced course was not found");
        }
      }

      const updated = await tx.questionBank.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.courseId !== undefined ? { courseId: input.courseId } : {}),
        },
      });

      await this.audit.record(
        {
          action: "question_bank.update",
          targetType: "question_bank",
          targetId: updated.id,
          actorUserId,
          meta: { title: updated.title, courseId: updated.courseId },
        },
        tx,
      );

      return updated;
    });
  }

  async delete(id: string, actorUserId: string) {
    const bank = await this.db.questionBank.findFirst({
      where: { id, deletedAt: null },
    });
    if (!bank) {
      throw fail(404, QuestionReasonCode.QUESTION_BANK_NOT_FOUND, "Question bank not found");
    }

    return this.db.$transaction(async (tx) => {
      const now = new Date();

      const updated = await tx.questionBank.update({
        where: { id },
        data: { deletedAt: now },
      });

      const { count: affectedQuestionsCount } = await tx.question.updateMany({
        where: { bankId: id, deletedAt: null },
        data: { deletedAt: now },
      });

      await this.audit.record(
        {
          action: "question_bank.delete",
          targetType: "question_bank",
          targetId: id,
          actorUserId,
          meta: { affectedQuestionsCount },
        },
        tx,
      );

      return {
        id: updated.id,
        deletedAt: updated.deletedAt,
        affectedQuestionsCount,
      };
    });
  }
}
