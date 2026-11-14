import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  getRequestContext,
  type Quiz,
  type QuizQuestion,
  type QuizTarget,
  type ScopedPrismaClient,
} from "@itqan/database";
import {
  QuizReasonCode,
  type QuizCreateInput,
  type QuizListQuery,
  type QuizReleaseGradesResponseDto,
  type QuizResponse,
  type QuizUpdateInput,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";

function fail(status: number, reason: string, message: string): never {
  const payload = { statusCode: status, reason, message };
  if (status === 404) throw new NotFoundException(payload);
  if (status === 409) throw new ConflictException(payload);
  throw new BadRequestException(payload);
}

type QuizWithRelations = Quiz & {
  targets: QuizTarget[];
  quizQuestions: QuizQuestion[];
};

const toResponse = (quiz: QuizWithRelations): QuizResponse => ({
  id: quiz.id,
  tenantId: quiz.tenantId,
  courseId: quiz.courseId,
  title: quiz.title,
  description: quiz.description,
  durationMin: quiz.durationMin,
  passMark: quiz.passMark,
  maxAttempts: quiz.maxAttempts,
  selection: quiz.selection,
  randomCount: quiz.randomCount,
  randomBankIds: quiz.randomBankIds,
  shuffleQuestions: quiz.shuffleQuestions,
  shuffleOptions: quiz.shuffleOptions,
  navigation: quiz.navigation,
  graceSec: quiz.graceSec,
  gradeRelease: quiz.gradeRelease,
  reviewMode: quiz.reviewMode,
  opensAt: quiz.opensAt.toISOString(),
  closesAt: quiz.closesAt?.toISOString() ?? null,
  gradesReleasedAt: quiz.gradesReleasedAt?.toISOString() ?? null,
  reviewReleaseAt: quiz.reviewReleaseAt?.toISOString() ?? null,
  publishedAt: quiz.publishedAt?.toISOString() ?? null,
  deletedAt: quiz.deletedAt?.toISOString() ?? null,
  createdAt: quiz.createdAt.toISOString(),
  updatedAt: quiz.updatedAt.toISOString(),
  targets: (quiz.targets ?? []).map((t) => ({
    id: t.id,
    contentItemId: t.contentItemId,
  })),
  questions: (quiz.quizQuestions ?? []).map((q) => ({
    id: q.id,
    questionId: q.questionId,
    sortOrder: q.sortOrder,
  })),
});

@Injectable()
export class QuizzesService {
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

  private validateTiming(opensAt: Date, closesAt: Date | null, durationMin: number) {
    if (!closesAt) return;
    const diffMs = closesAt.getTime() - opensAt.getTime();
    if (diffMs < durationMin * 60 * 1000) {
      throw fail(
        400,
        QuizReasonCode.INVALID_TIMING_WINDOW,
        `Closing time must be at least ${durationMin} minutes after opening time`,
      );
    }
  }

  async create(input: QuizCreateInput, actorUserId: string): Promise<QuizResponse> {
    const tenantId = this.getTenantId();

    const course = await this.db.course.findFirst({
      where: { id: input.courseId, deletedAt: null },
    });
    if (!course) {
      throw fail(404, "COURSE_NOT_FOUND", "Course not found");
    }

    const opensAt = new Date(input.opensAt);
    const closesAt = input.closesAt ? new Date(input.closesAt) : null;
    this.validateTiming(opensAt, closesAt, input.durationMin);

    if (input.selection === "random") {
      if (
        !input.randomBankIds ||
        input.randomBankIds.length === 0 ||
        !input.randomCount ||
        input.randomCount < 1
      ) {
        throw fail(
          400,
          "INVALID_RANDOM_SETTINGS",
          "Random selection requires non-empty randomBankIds and randomCount >= 1",
        );
      }
      await this.validateBanksAndCount(input.randomBankIds, input.randomCount, input.courseId);
    } else if (input.questionIds.length > 0) {
      await this.validateQuestions(input.questionIds, input.courseId);
    }

    if (input.targetContentItemIds.length > 0) {
      await this.validateTargets(input.targetContentItemIds, input.courseId);
    }

    return this.db.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          tenantId,
          courseId: input.courseId,
          title: input.title,
          description: input.description ?? null,
          durationMin: input.durationMin,
          passMark: input.passMark,
          maxAttempts: input.maxAttempts,
          selection: input.selection,
          randomCount: input.selection === "random" ? input.randomCount : null,
          randomBankIds: input.selection === "random" ? input.randomBankIds : [],
          shuffleQuestions: input.shuffleQuestions,
          shuffleOptions: input.shuffleOptions,
          navigation: input.navigation,
          graceSec: input.graceSec ?? 10,
          gradeRelease: input.gradeRelease,
          reviewMode: input.reviewMode,
          opensAt,
          closesAt,
          reviewReleaseAt: input.reviewReleaseAt ? new Date(input.reviewReleaseAt) : null,
        },
      });

      if (input.selection === "manual" && input.questionIds.length > 0) {
        for (let i = 0; i < input.questionIds.length; i++) {
          await tx.quizQuestion.create({
            data: {
              tenantId,
              quizId: quiz.id,
              questionId: input.questionIds[i]!,
              sortOrder: i,
            },
          });
        }
      }

      if (input.targetContentItemIds.length > 0) {
        for (const contentItemId of input.targetContentItemIds) {
          await tx.quizTarget.create({
            data: {
              tenantId,
              quizId: quiz.id,
              contentItemId,
            },
          });
        }
      }

      await this.audit.record(
        {
          action: "quiz.create",
          targetType: "quiz",
          targetId: quiz.id,
          actorUserId,
          meta: { courseId: quiz.courseId, title: quiz.title, selection: quiz.selection },
        },
        tx,
      );

      const created = await tx.quiz.findUniqueOrThrow({
        where: { id: quiz.id },
        include: {
          targets: true,
          quizQuestions: { orderBy: { sortOrder: "asc" } },
        },
      });

      return toResponse(created as QuizWithRelations);
    });
  }

  async update(id: string, input: QuizUpdateInput, actorUserId: string): Promise<QuizResponse> {
    const tenantId = this.getTenantId();

    const existing = await this.db.quiz.findFirst({
      where: { id, deletedAt: null },
      include: {
        targets: true,
        quizQuestions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!existing) {
      throw fail(404, QuizReasonCode.QUIZ_NOT_FOUND, "Quiz not found");
    }

    if (existing.publishedAt !== null) {
      const allowedKeys = new Set(["opensAt", "closesAt"]);
      const requestedKeys = Object.keys(input).filter(
        (k) => (input as Record<string, unknown>)[k] !== undefined,
      );
      const invalidKeys = requestedKeys.filter((k) => !allowedKeys.has(k));
      if (invalidKeys.length > 0) {
        throw fail(
          400,
          QuizReasonCode.QUIZ_MUTATION_LOCKED,
          "Published quizzes lock structural settings; only timing fields (opensAt, closesAt) can be updated",
        );
      }

      const opensAt = input.opensAt ? new Date(input.opensAt) : existing.opensAt;
      const closesAt =
        input.closesAt !== undefined
          ? input.closesAt
            ? new Date(input.closesAt)
            : null
          : existing.closesAt;
      this.validateTiming(opensAt, closesAt, existing.durationMin);

      return this.db.$transaction(async (tx) => {
        const updated = await tx.quiz.update({
          where: { id },
          data: {
            opensAt,
            closesAt,
          },
          include: {
            targets: true,
            quizQuestions: { orderBy: { sortOrder: "asc" } },
          },
        });

        await this.audit.record(
          {
            action: "quiz.update",
            targetType: "quiz",
            targetId: id,
            actorUserId,
            meta: { opensAt: opensAt.toISOString(), closesAt: closesAt?.toISOString() ?? null },
          },
          tx,
        );

        return toResponse(updated as QuizWithRelations);
      });
    }

    const durationMin = input.durationMin ?? existing.durationMin;
    const opensAt = input.opensAt ? new Date(input.opensAt) : existing.opensAt;
    const closesAt =
      input.closesAt !== undefined
        ? input.closesAt
          ? new Date(input.closesAt)
          : null
        : existing.closesAt;
    this.validateTiming(opensAt, closesAt, durationMin);

    const selection = input.selection ?? existing.selection;
    const randomBankIds = input.randomBankIds ?? existing.randomBankIds;
    const randomCount = input.randomCount !== undefined ? input.randomCount : existing.randomCount;

    if (selection === "random") {
      if (!randomBankIds || randomBankIds.length === 0 || !randomCount || randomCount < 1) {
        throw fail(
          400,
          "INVALID_RANDOM_SETTINGS",
          "Random selection requires non-empty randomBankIds and randomCount >= 1",
        );
      }
      await this.validateBanksAndCount(randomBankIds, randomCount, existing.courseId);
    } else if (input.questionIds !== undefined && input.questionIds.length > 0) {
      await this.validateQuestions(input.questionIds, existing.courseId);
    }

    if (input.targetContentItemIds !== undefined && input.targetContentItemIds.length > 0) {
      await this.validateTargets(input.targetContentItemIds, existing.courseId);
    }

    return this.db.$transaction(async (tx) => {
      const data: Record<string, unknown> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.durationMin !== undefined) data.durationMin = input.durationMin;
      if (input.passMark !== undefined) data.passMark = input.passMark;
      if (input.maxAttempts !== undefined) data.maxAttempts = input.maxAttempts;
      if (input.selection !== undefined) data.selection = input.selection;
      if (input.randomCount !== undefined)
        data.randomCount = selection === "random" ? input.randomCount : null;
      if (input.randomBankIds !== undefined)
        data.randomBankIds = selection === "random" ? input.randomBankIds : [];
      if (input.shuffleQuestions !== undefined) data.shuffleQuestions = input.shuffleQuestions;
      if (input.shuffleOptions !== undefined) data.shuffleOptions = input.shuffleOptions;
      if (input.navigation !== undefined) data.navigation = input.navigation;
      if (input.graceSec !== undefined) data.graceSec = input.graceSec;
      if (input.gradeRelease !== undefined) data.gradeRelease = input.gradeRelease;
      if (input.reviewMode !== undefined) data.reviewMode = input.reviewMode;
      if (input.opensAt !== undefined) data.opensAt = opensAt;
      if (input.closesAt !== undefined) data.closesAt = closesAt;
      if (input.reviewReleaseAt !== undefined) {
        data.reviewReleaseAt = input.reviewReleaseAt ? new Date(input.reviewReleaseAt) : null;
      }

      await tx.quiz.update({
        where: { id },
        data,
      });

      if (input.questionIds !== undefined) {
        await tx.quizQuestion.deleteMany({ where: { quizId: id } });
        if (selection === "manual") {
          for (let i = 0; i < input.questionIds.length; i++) {
            await tx.quizQuestion.create({
              data: {
                tenantId,
                quizId: id,
                questionId: input.questionIds[i]!,
                sortOrder: i,
              },
            });
          }
        }
      }

      if (input.targetContentItemIds !== undefined) {
        await tx.quizTarget.deleteMany({ where: { quizId: id } });
        for (const contentItemId of input.targetContentItemIds) {
          await tx.quizTarget.create({
            data: {
              tenantId,
              quizId: id,
              contentItemId,
            },
          });
        }
      }

      await this.audit.record(
        {
          action: "quiz.update",
          targetType: "quiz",
          targetId: id,
          actorUserId,
          meta: { changes: Object.keys(data) },
        },
        tx,
      );

      const updated = await tx.quiz.findUniqueOrThrow({
        where: { id },
        include: {
          targets: true,
          quizQuestions: { orderBy: { sortOrder: "asc" } },
        },
      });

      return toResponse(updated as QuizWithRelations);
    });
  }

  async publish(id: string, actorUserId: string): Promise<QuizResponse> {
    const existing = await this.db.quiz.findFirst({
      where: { id, deletedAt: null },
      include: {
        targets: true,
        quizQuestions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!existing) {
      throw fail(404, QuizReasonCode.QUIZ_NOT_FOUND, "Quiz not found");
    }

    if (existing.publishedAt !== null) {
      throw fail(409, QuizReasonCode.QUIZ_ALREADY_PUBLISHED, "Quiz is already published");
    }

    if (existing.selection === "manual") {
      if (existing.quizQuestions.length === 0) {
        throw fail(
          400,
          "INVALID_QUIZ",
          "Manual quiz must contain at least one question before publishing",
        );
      }
    } else if (existing.selection === "random") {
      if (
        !existing.randomBankIds ||
        existing.randomBankIds.length === 0 ||
        !existing.randomCount ||
        existing.randomCount < 1
      ) {
        throw fail(400, "INVALID_QUIZ", "Random quiz must specify question banks and randomCount");
      }
      await this.validateBanksAndCount(
        existing.randomBankIds,
        existing.randomCount,
        existing.courseId,
      );
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.quiz.update({
        where: { id },
        data: { publishedAt: new Date() },
        include: {
          targets: true,
          quizQuestions: { orderBy: { sortOrder: "asc" } },
        },
      });

      await this.audit.record(
        {
          action: "quiz.publish",
          targetType: "quiz",
          targetId: id,
          actorUserId,
          meta: { courseId: updated.courseId },
        },
        tx,
      );

      return toResponse(updated as QuizWithRelations);
    });
  }

  async unpublish(id: string, actorUserId: string): Promise<QuizResponse> {
    const existing = await this.db.quiz.findFirst({
      where: { id, deletedAt: null },
      include: {
        targets: true,
        quizQuestions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!existing) {
      throw fail(404, QuizReasonCode.QUIZ_NOT_FOUND, "Quiz not found");
    }

    if (existing.publishedAt === null) {
      throw fail(400, QuizReasonCode.QUIZ_NOT_PUBLISHED, "Quiz is not published");
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.quiz.update({
        where: { id },
        data: { publishedAt: null },
        include: {
          targets: true,
          quizQuestions: { orderBy: { sortOrder: "asc" } },
        },
      });

      await this.audit.record(
        {
          action: "quiz.unpublish",
          targetType: "quiz",
          targetId: id,
          actorUserId,
          meta: { courseId: updated.courseId },
        },
        tx,
      );

      return toResponse(updated as QuizWithRelations);
    });
  }

  async delete(id: string, actorUserId: string): Promise<{ success: true }> {
    const existing = await this.db.quiz.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw fail(404, QuizReasonCode.QUIZ_NOT_FOUND, "Quiz not found");
    }

    await this.db.$transaction(async (tx) => {
      await tx.quiz.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await this.audit.record(
        {
          action: "quiz.delete",
          targetType: "quiz",
          targetId: id,
          actorUserId,
          meta: { courseId: existing.courseId, title: existing.title },
        },
        tx,
      );
    });

    return { success: true };
  }

  async getById(id: string): Promise<QuizResponse> {
    const quiz = await this.db.quiz.findFirst({
      where: { id, deletedAt: null },
      include: {
        targets: true,
        quizQuestions: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!quiz) {
      throw fail(404, QuizReasonCode.QUIZ_NOT_FOUND, "Quiz not found");
    }
    return toResponse(quiz as QuizWithRelations);
  }

  async list(query: QuizListQuery): Promise<QuizResponse[]> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (query.courseId) where.courseId = query.courseId;
    if (query.published === "true") where.publishedAt = { not: null };
    else if (query.published === "false") where.publishedAt = null;

    const quizzes = await this.db.quiz.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        targets: true,
        quizQuestions: { orderBy: { sortOrder: "asc" } },
      },
    });

    return quizzes.map((q) => toResponse(q as QuizWithRelations));
  }

  async releaseGrades(id: string, actorUserId: string): Promise<QuizReleaseGradesResponseDto> {
    const existing = await this.db.quiz.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw fail(404, QuizReasonCode.QUIZ_NOT_FOUND, "Quiz not found");
    }

    const now = new Date();
    const updated = await this.db.quiz.update({
      where: { id },
      data: { gradesReleasedAt: now },
    });

    await this.audit.record({
      action: "quiz.release_grades",
      targetType: "quiz",
      targetId: updated.id,
      actorUserId,
      meta: {
        courseId: updated.courseId,
        title: updated.title,
        gradesReleasedAt: now.toISOString(),
      },
    });

    return {
      success: true,
      quizId: updated.id,
      gradesReleasedAt: now.toISOString(),
    };
  }

  private async validateBanksAndCount(bankIds: string[], randomCount: number, courseId: string) {
    const banks = await this.db.questionBank.findMany({
      where: { id: { in: bankIds }, deletedAt: null },
    });
    if (banks.length !== bankIds.length) {
      throw fail(400, "BANK_NOT_FOUND", "One or more referenced question banks do not exist");
    }
    for (const bank of banks) {
      if (bank.courseId && bank.courseId !== courseId) {
        throw fail(
          400,
          QuizReasonCode.QUESTION_COURSE_MISMATCH,
          `Question bank ${bank.title} belongs to a different course`,
        );
      }
    }

    const activeQuestionCount = await this.db.question.count({
      where: {
        bankId: { in: bankIds },
        deletedAt: null,
      },
    });

    if (activeQuestionCount < randomCount) {
      throw fail(
        400,
        QuizReasonCode.INSUFFICIENT_BANK_QUESTIONS,
        `Referenced banks contain ${activeQuestionCount} active questions, but randomCount is ${randomCount}`,
      );
    }
  }

  private async validateQuestions(questionIds: string[], courseId: string) {
    const questions = await this.db.question.findMany({
      where: { id: { in: questionIds }, deletedAt: null },
      include: { bank: true },
    });
    if (questions.length !== questionIds.length) {
      throw fail(404, QuizReasonCode.QUESTION_NOT_FOUND, "One or more questions not found");
    }
    for (const q of questions) {
      if (q.bank.courseId && q.bank.courseId !== courseId) {
        throw fail(
          400,
          QuizReasonCode.QUESTION_COURSE_MISMATCH,
          `Question belongs to a bank attached to a different course`,
        );
      }
    }
  }

  private async validateTargets(targetItemIds: string[], courseId: string) {
    const items = await this.db.contentItem.findMany({
      where: { id: { in: targetItemIds }, deletedAt: null },
    });
    if (items.length !== targetItemIds.length) {
      throw fail(
        400,
        QuizReasonCode.INVALID_TARGET,
        "One or more target content items do not exist",
      );
    }
    for (const item of items) {
      if (item.courseId !== courseId) {
        throw fail(
          400,
          QuizReasonCode.TARGET_COURSE_MISMATCH,
          `Target item ${item.title} belongs to a different course`,
        );
      }
    }
  }
}
