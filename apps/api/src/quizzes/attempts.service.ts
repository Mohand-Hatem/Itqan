import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomInt } from "node:crypto";
import type { AuthSession, AuthUser } from "@itqan/auth";
import {
  getRequestContext,
  type Attempt,
  type AttemptAnswer,
  type Membership,
  type Quiz,
  type QuizNavigation,
  type ScopedPrismaClient,
} from "@itqan/database";
import {
  ATTEMPT_GRACE_PERIOD_SEC,
  AttemptReasonCode,
  type AttemptAnswersResponseDto,
  type AttemptExtendTimeDto,
  type AttemptExtendTimeResponseDto,
  type AttemptMoveDeviceDto,
  type AttemptMoveDeviceResponseDto,
  type AttemptResponseDto,
  type AttemptReviewResponseDto,
  type AttemptStatus,
  type AttemptSubmitResponseDto,
  type GradeRelease,
  type ReviewMode,
  type ReviewQuestionDto,
  type SaveAttemptAnswerDto,
  type SavedAttemptAnswerDto,
  type StoredAttemptQuestion,
  type StoredAttemptSnapshot,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { EnrollmentsService } from "../enrollments/enrollments.service.js";
import { gradeAttempt, isGradeReleased, isReviewReleased } from "./grading/attempt-grading.engine.js";

function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

@Injectable()
export class AttemptsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EnrollmentsService) private readonly enrollments: EnrollmentsService,
  ) {}

  async startOrResume(
    quizId: string,
    user: AuthUser,
    session: AuthSession,
    membership: Membership,
  ): Promise<{ resumed: boolean; dto: AttemptResponseDto }> {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "No tenant context found.",
      });
    }
    const tenantId = ctx.tenantId;

    if (!membership || membership.status !== "active") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "You do not have active access to this academy.",
      });
    }

    if (!session?.deviceId) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AttemptReasonCode.DEVICE_NOT_REGISTERED,
        message: "A registered device is required to take quizzes.",
      });
    }

    const quiz = await this.db.quiz.findUnique({
      where: { id: quizId },
      include: {
        quizQuestions: {
          orderBy: { sortOrder: "asc" },
          include: {
            question: {
              include: {
                options: {
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
      },
    });

    if (!quiz || quiz.deletedAt !== null) {
      throw new NotFoundException({
        statusCode: 404,
        reason: "QUIZ_NOT_FOUND",
        message: "Quiz not found.",
      });
    }

    if (!quiz.publishedAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.QUIZ_NOT_PUBLISHED,
        message: "Quiz is not published.",
      });
    }

    // Verify course enrollment (reusing membership already resolved by AccessGuard)
    await this.enrollments.checkAccess(quiz.courseId, user, membership);

    const now = new Date();
    if (now < quiz.opensAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.QUIZ_NOT_OPEN,
        message: "Quiz is not open yet.",
      });
    }

    if (quiz.closesAt && now >= quiz.closesAt) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.QUIZ_CLOSED,
        message: "Quiz is closed.",
      });
    }

    // Check existing attempts
    const existingAttempts = await this.db.attempt.findMany({
      where: {
        quizId,
        membershipId: membership.id,
      },
      orderBy: { attemptNo: "asc" },
    });

    const activeAttempt = existingAttempts.find((att) => {
      const hasNotSubmitted = att.submittedAt === null;
      const notExpired = now.getTime() < att.deadlineAt.getTime() + att.extraTimeSec * 1000;
      return hasNotSubmitted && notExpired;
    });

    if (activeAttempt) {
      if (activeAttempt.deviceId !== session.deviceId) {
        throw new ForbiddenException({
          statusCode: 403,
          reason: AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH,
          message: "This attempt is tied to a different device.",
        });
      }
      return {
        resumed: true,
        dto: this.toStudentResponse(activeAttempt, quiz, true, now),
      };
    }

    if (existingAttempts.length >= quiz.maxAttempts) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AttemptReasonCode.MAX_ATTEMPTS_REACHED,
        message: "Maximum attempts reached for this quiz.",
      });
    }

    // Select questions
    let questions: Array<{
      id: string;
      text: string;
      type: "single" | "multiple" | "true_false";
      marks: number;
      explanation: string | null;
      imageAssetId: string | null;
      options: Array<{
        id: string;
        text: string;
        isCorrect: boolean;
        sortOrder: number;
      }>;
    }> = [];

    if (quiz.selection === "manual") {
      questions = quiz.quizQuestions
        .filter((qq) => qq.question && qq.question.deletedAt === null)
        .map((qq) => ({
          id: qq.question.id,
          text: qq.question.text,
          type: qq.question.type as "single" | "multiple" | "true_false",
          marks: qq.question.marks,
          explanation: qq.question.explanation,
          imageAssetId: qq.question.imageAssetId,
          options: qq.question.options.map((o) => ({
            id: o.id,
            text: o.text,
            isCorrect: o.isCorrect,
            sortOrder: o.sortOrder,
          })),
        }));

      if (questions.length === 0) {
        throw new BadRequestException({
          statusCode: 400,
          reason: AttemptReasonCode.INSUFFICIENT_BANK_QUESTIONS,
          message: "No active questions available for this quiz.",
        });
      }

      if (quiz.shuffleQuestions) {
        questions = shuffleArray(questions);
      }
    } else {
      const requiredCount = quiz.randomCount ?? 0;
      const bankQuestions = await this.db.question.findMany({
        where: {
          bankId: { in: quiz.randomBankIds },
          deletedAt: null,
        },
        include: {
          options: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });

      if (bankQuestions.length < requiredCount || requiredCount === 0) {
        throw new BadRequestException({
          statusCode: 400,
          reason: AttemptReasonCode.INSUFFICIENT_BANK_QUESTIONS,
          message: "Not enough active questions available in question banks.",
        });
      }

      const shuffledBank = shuffleArray(bankQuestions);
      const sampled = shuffledBank.slice(0, requiredCount);
      questions = sampled.map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type as "single" | "multiple" | "true_false",
        marks: q.marks,
        explanation: q.explanation,
        imageAssetId: q.imageAssetId,
        options: q.options.map((o) => ({
          id: o.id,
          text: o.text,
          isCorrect: o.isCorrect,
          sortOrder: o.sortOrder,
        })),
      }));

      if (quiz.shuffleQuestions) {
        questions = shuffleArray(questions);
      }
    }

    // Process options per question (true_false fixed, single/multiple shuffled if enabled)
    const snapshotQuestions: StoredAttemptQuestion[] = questions.map((q) => {
      let opts = [...q.options];
      if (q.type === "true_false") {
        opts.sort((a, b) => {
          const aLower = a.text.trim().toLowerCase();
          const bLower = b.text.trim().toLowerCase();
          if (aLower === "true" || aLower === "صواب" || aLower === "صح") return -1;
          if (bLower === "true" || bLower === "صواب" || bLower === "صح") return 1;
          return a.sortOrder - b.sortOrder;
        });
      } else if (quiz.shuffleOptions) {
        opts = shuffleArray(opts);
      } else {
        opts.sort((a, b) => a.sortOrder - b.sortOrder);
      }

      return {
        id: q.id,
        text: q.text,
        type: q.type,
        marks: q.marks,
        explanation: q.explanation ?? null,
        imageAssetId: q.imageAssetId ?? null,
        options: opts.map((opt, idx) => ({
          id: opt.id,
          text: opt.text,
          isCorrect: opt.isCorrect,
          sortOrder: idx,
        })),
      };
    });

    const maxScore = snapshotQuestions.reduce((sum, q) => sum + (q.marks ?? 1), 0);

    // Hard-clipped deadline: min(now + durationMin, closesAt)
    const nominalDeadline = new Date(now.getTime() + quiz.durationMin * 60 * 1000);
    const deadlineAt =
      quiz.closesAt && quiz.closesAt < nominalDeadline ? quiz.closesAt : nominalDeadline;

    const attemptNo = existingAttempts.length + 1;
    const snapshot: StoredAttemptSnapshot = { questions: snapshotQuestions };

    try {
      const created = await this.db.attempt.create({
        data: {
          tenantId,
          quizId,
          membershipId: membership.id,
          deviceId: session.deviceId,
          attemptNo,
          startedAt: now,
          deadlineAt,
          extraTimeSec: 0,
          maxScore,
          snapshot: snapshot as unknown as object,
        },
      });

      await this.audit.record({
        action: "attempt.start",
        targetType: "attempt",
        targetId: created.id,
        meta: {
          quizId,
          attemptNo,
          deviceId: session.deviceId,
        },
      });

      return {
        resumed: false,
        dto: this.toStudentResponse(created, quiz, false, now),
      };
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "P2002") {
        const concurrentActive = await this.db.attempt.findFirst({
          where: {
            quizId,
            membershipId: membership.id,
            submittedAt: null,
            deadlineAt: { gt: new Date() },
          },
        });
        if (concurrentActive) {
          if (concurrentActive.deviceId !== session.deviceId) {
            throw new ForbiddenException({
              statusCode: 403,
              reason: AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH,
              message: "This attempt is tied to a different device.",
            });
          }
          return {
            resumed: true,
            dto: this.toStudentResponse(concurrentActive, quiz, true, new Date()),
          };
        }
      }
      throw err;
    }
  }

  async getAttempt(
    attemptId: string,
    _user: AuthUser,
    session: AuthSession,
    membership: Membership,
  ): Promise<AttemptResponseDto> {
    const attempt = await this.db.attempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true },
    });

    if (!attempt || attempt.membershipId !== membership.id) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    const now = new Date();
    const graceSec = attempt.quiz.graceSec ?? ATTEMPT_GRACE_PERIOD_SEC;
    const deadlineMs = attempt.deadlineAt.getTime() + (attempt.extraTimeSec ?? 0) * 1000;
    const deadlineWithGraceMs = deadlineMs + graceSec * 1000;

    // Auto-submit on read if deadline has expired
    if (attempt.submittedAt === null && now.getTime() > deadlineWithGraceMs) {
      const nominalDeadline = new Date(deadlineMs);
      const finalized = await this.finalizeAttempt(attempt.id, nominalDeadline, true);
      let allSubmitted = false;
      if (finalized.quiz.gradeRelease === "all_submitted") {
        allSubmitted = await this.checkAllSubmitted(finalized.quiz.id, finalized.quiz.courseId);
      }
      return this.toStudentResponse(finalized, finalized.quiz, false, now, allSubmitted);
    }

    const isActive = attempt.submittedAt === null && now.getTime() < deadlineMs;

    if (isActive && attempt.deviceId !== session?.deviceId) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH,
        message: "This attempt is tied to a different device.",
      });
    }

    let allSubmitted = false;
    if (attempt.quiz.gradeRelease === "all_submitted") {
      allSubmitted = await this.checkAllSubmitted(attempt.quiz.id, attempt.quiz.courseId);
    }

    return this.toStudentResponse(attempt, attempt.quiz, false, now, allSubmitted);
  }

  async saveAnswer(
    attemptId: string,
    questionId: string,
    input: SaveAttemptAnswerDto,
    _user: AuthUser,
    session: AuthSession,
    membership: Membership,
  ): Promise<SavedAttemptAnswerDto> {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "No tenant context found.",
      });
    }
    const tenantId = ctx.tenantId;

    if (!membership || membership.status !== "active") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "You do not have active access to this academy.",
      });
    }

    const attempt = await this.db.attempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true },
    });

    if (!attempt || attempt.membershipId !== membership.id) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    if (attempt.deviceId !== session?.deviceId) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH,
        message: "This attempt is tied to a different device.",
      });
    }

    if (attempt.submittedAt !== null) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.ATTEMPT_ALREADY_SUBMITTED,
        message: "This attempt has already been submitted.",
      });
    }

    const now = new Date();
    const graceSec = attempt.quiz.graceSec ?? ATTEMPT_GRACE_PERIOD_SEC;
    const deadlineWithGraceMs =
      attempt.deadlineAt.getTime() + (attempt.extraTimeSec + graceSec) * 1000;
    if (now.getTime() > deadlineWithGraceMs) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.ATTEMPT_EXPIRED,
        message: "The deadline for this attempt has passed.",
      });
    }

    const snapshot = attempt.snapshot as unknown as StoredAttemptSnapshot;
    const questions = snapshot?.questions ?? [];
    const questionIndex = questions.findIndex((q) => q.id === questionId);
    if (questionIndex === -1) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.QUESTION_NOT_IN_ATTEMPT,
        message: "Question does not exist in this quiz attempt.",
      });
    }
    const targetQuestion = questions[questionIndex]!;

    const distinctOptionIds = Array.from(new Set(input.selectedOptionIds));
    const validOptionIds = new Set(targetQuestion.options.map((o) => o.id));
    for (const optId of distinctOptionIds) {
      if (!validOptionIds.has(optId)) {
        throw new BadRequestException({
          statusCode: 400,
          reason: AttemptReasonCode.INVALID_QUESTION_OPTION,
          message: "One or more selected options are invalid for this question.",
        });
      }
    }

    if (
      (targetQuestion.type === "single" || targetQuestion.type === "true_false") &&
      distinctOptionIds.length > 1
    ) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.SINGLE_CHOICE_VIOLATION,
        message: "Only one option can be selected for this question.",
      });
    }

    if (attempt.quiz.navigation === "linear") {
      const existingAnswers = await this.db.attemptAnswer.findMany({
        where: { attemptId },
        select: { questionId: true },
      });

      let maxAnsweredIndex = -1;
      for (const ans of existingAnswers) {
        const idx = questions.findIndex((q) => q.id === ans.questionId);
        if (idx > maxAnsweredIndex) {
          maxAnsweredIndex = idx;
        }
      }

      if (questionIndex < maxAnsweredIndex) {
        throw new BadRequestException({
          statusCode: 400,
          reason: AttemptReasonCode.LINEAR_NAVIGATION_BACKTRACK_FORBIDDEN,
          message: "Cannot modify answers to previous questions in linear navigation mode.",
        });
      }

      if (questionIndex > maxAnsweredIndex + 1) {
        throw new BadRequestException({
          statusCode: 400,
          reason: AttemptReasonCode.LINEAR_NAVIGATION_SKIP_FORBIDDEN,
          message: "Questions must be answered sequentially in linear navigation mode.",
        });
      }
    }

    const saved = await this.db.attemptAnswer.upsert({
      where: {
        attemptId_questionId: {
          attemptId,
          questionId,
        },
      },
      update: {
        selectedOptionIds: distinctOptionIds,
        savedAt: now,
      },
      create: {
        tenantId,
        attemptId,
        questionId,
        selectedOptionIds: distinctOptionIds,
        savedAt: now,
      },
    });

    return {
      questionId: saved.questionId,
      selectedOptionIds: saved.selectedOptionIds,
      savedAt: saved.savedAt.toISOString(),
    };
  }

  async getAnswers(
    attemptId: string,
    _user: AuthUser,
    session: AuthSession,
    membership: Membership,
  ): Promise<AttemptAnswersResponseDto> {
    if (!membership || membership.status !== "active") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "You do not have active access to this academy.",
      });
    }

    const attempt = await this.db.attempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true },
    });

    if (!attempt || attempt.membershipId !== membership.id) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    const now = new Date();
    const graceSec = attempt.quiz.graceSec ?? ATTEMPT_GRACE_PERIOD_SEC;
    const deadlineMs = attempt.deadlineAt.getTime() + (attempt.extraTimeSec ?? 0) * 1000;
    const deadlineWithGraceMs = deadlineMs + graceSec * 1000;

    // Auto-submit on read if deadline has expired
    if (attempt.submittedAt === null && now.getTime() > deadlineWithGraceMs) {
      const nominalDeadline = new Date(deadlineMs);
      await this.finalizeAttempt(attempt.id, nominalDeadline, true);
    }

    const isActive = attempt.submittedAt === null && now.getTime() < deadlineWithGraceMs;

    if (isActive && attempt.deviceId !== session?.deviceId) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH,
        message: "This attempt is tied to a different device.",
      });
    }

    const answers = await this.db.attemptAnswer.findMany({
      where: { attemptId },
      orderBy: { savedAt: "asc" },
    });

    return {
      answers: answers.map((a) => ({
        questionId: a.questionId,
        selectedOptionIds: a.selectedOptionIds,
        savedAt: a.savedAt.toISOString(),
      })),
    };
  }

  async submit(
    attemptId: string,
    _user: AuthUser,
    session: AuthSession,
    membership: Membership,
  ): Promise<AttemptSubmitResponseDto> {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "No tenant context found.",
      });
    }

    if (!membership || membership.status !== "active") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "You do not have active access to this academy.",
      });
    }

    const attempt = await this.db.attempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true },
    });

    if (!attempt || attempt.membershipId !== membership.id) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    if (attempt.deviceId !== session?.deviceId) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AttemptReasonCode.ATTEMPT_DEVICE_MISMATCH,
        message: "This attempt is tied to a different device.",
      });
    }

    const now = new Date();

    let allSubmitted = false;
    if (attempt.quiz.gradeRelease === "all_submitted") {
      allSubmitted = await this.checkAllSubmitted(attempt.quiz.id, attempt.quiz.courseId);
    }

    // Idempotent return if already submitted
    if (attempt.submittedAt !== null) {
      return this.toSubmitResponse(attempt, attempt.quiz, false, now, allSubmitted);
    }

    const graceSec = attempt.quiz.graceSec ?? ATTEMPT_GRACE_PERIOD_SEC;
    const deadlineMs = attempt.deadlineAt.getTime() + (attempt.extraTimeSec ?? 0) * 1000;
    const deadlineWithGraceMs = deadlineMs + graceSec * 1000;

    const isLate = now.getTime() > deadlineWithGraceMs;
    const effectiveSubmittedAt = isLate ? new Date(deadlineMs) : now;

    const finalized = await this.finalizeAttempt(attempt.id, effectiveSubmittedAt, isLate);

    // Re-check allSubmitted after finalizing this attempt
    if (attempt.quiz.gradeRelease === "all_submitted") {
      allSubmitted = await this.checkAllSubmitted(attempt.quiz.id, attempt.quiz.courseId);
    }

    return this.toSubmitResponse(finalized, attempt.quiz, isLate, now, allSubmitted);
  }

  private async finalizeAttempt(
    attemptId: string,
    effectiveSubmittedAt: Date,
    isAutoSubmit: boolean,
  ): Promise<Attempt & { quiz: Quiz }> {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "No tenant context found.",
      });
    }
    const tenantId = ctx.tenantId;

    return await this.db.$transaction(async (tx) => {
      const attempt = await tx.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { quiz: true },
      });

      if (attempt.submittedAt !== null) {
        return attempt;
      }

      const snapshot = attempt.snapshot as unknown as StoredAttemptSnapshot;
      const snapshotQuestions = snapshot?.questions ?? [];

      const existingAnswers = await tx.attemptAnswer.findMany({
        where: { attemptId },
      });

      const grading = gradeAttempt(
        snapshotQuestions,
        existingAnswers.map((a) => ({
          questionId: a.questionId,
          selectedOptionIds: a.selectedOptionIds,
        })),
        attempt.quiz.passMark,
        attempt.maxScore,
      );

      const updateResult = await tx.attempt.updateMany({
        where: {
          id: attemptId,
          submittedAt: null,
        },
        data: {
          submittedAt: effectiveSubmittedAt,
          score: grading.score,
          passed: grading.passed,
        },
      });

      if (updateResult.count === 0) {
        return tx.attempt.findUniqueOrThrow({
          where: { id: attemptId },
          include: { quiz: true },
        });
      }

      const existingAnswerMap = new Map(existingAnswers.map((a) => [a.questionId, a.id]));
      const missingAnswers: Array<{
        tenantId: string;
        attemptId: string;
        questionId: string;
        selectedOptionIds: string[];
        isCorrect: boolean;
        marksAwarded: number;
      }> = [];

      for (const graded of grading.answers) {
        const existingId = existingAnswerMap.get(graded.questionId);
        if (existingId) {
          await tx.attemptAnswer.update({
            where: { id: existingId },
            data: {
              isCorrect: graded.isCorrect,
              marksAwarded: graded.marksAwarded,
            },
          });
        } else {
          missingAnswers.push({
            tenantId,
            attemptId,
            questionId: graded.questionId,
            selectedOptionIds: [],
            isCorrect: false,
            marksAwarded: 0,
          });
        }
      }

      if (missingAnswers.length > 0) {
        await tx.attemptAnswer.createMany({
          data: missingAnswers,
          skipDuplicates: true,
        });
      }

      await this.audit.record(
        {
          action: "attempt.submit",
          targetType: "attempt",
          targetId: attempt.id,
          meta: {
            quizId: attempt.quizId,
            attemptNo: attempt.attemptNo,
            score: grading.score,
            passed: grading.passed,
            isAutoSubmit,
            effectiveSubmittedAt: effectiveSubmittedAt.toISOString(),
          },
        },
        tx,
      );

      return tx.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { quiz: true },
      });
    });
  }

  private toSubmitResponse(
    attempt: Attempt,
    quiz: {
      gradeRelease: GradeRelease;
      closesAt: Date | null;
      gradesReleasedAt?: Date | null;
    },
    autoSubmitted: boolean,
    now: Date = new Date(),
    allSubmitted = false,
  ): AttemptSubmitResponseDto {
    const gradesReleased = isGradeReleased(
      {
        gradeRelease: quiz.gradeRelease,
        closesAt: quiz.closesAt,
        gradesReleasedAt: quiz.gradesReleasedAt ?? null,
        allSubmitted,
      },
      now,
    );
    const maxScore = attempt.maxScore;
    const score = gradesReleased ? attempt.score : null;
    const percentage =
      gradesReleased && attempt.score !== null && maxScore > 0
        ? Math.round((attempt.score / maxScore) * 10000) / 100
        : gradesReleased && attempt.score !== null && maxScore === 0
          ? 100
          : null;
    const passed = gradesReleased ? attempt.passed : null;

    return {
      id: attempt.id,
      quizId: attempt.quizId,
      attemptNo: attempt.attemptNo,
      status: "submitted",
      submittedAt: attempt.submittedAt!.toISOString(),
      autoSubmitted,
      gradesReleased,
      score,
      maxScore: gradesReleased ? maxScore : null,
      percentage,
      passed,
    };
  }

  private toStudentResponse(
    attempt: Attempt,
    quiz: {
      title: string;
      navigation: QuizNavigation;
      gradeRelease?: GradeRelease;
      closesAt?: Date | null;
      gradesReleasedAt?: Date | null;
    },
    resumed: boolean,
    now: Date = new Date(),
    allSubmitted = false,
  ): AttemptResponseDto {
    const snapshot = attempt.snapshot as unknown as StoredAttemptSnapshot;
    const questions = (snapshot?.questions ?? []).map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      marks: q.marks,
      imageAssetId: q.imageAssetId ?? null,
      options: (q.options ?? []).map((opt) => ({
        id: opt.id,
        text: opt.text,
      })),
    }));

    const deadlineMs = attempt.deadlineAt.getTime() + (attempt.extraTimeSec ?? 0) * 1000;
    const remainingSeconds =
      attempt.submittedAt !== null
        ? 0
        : Math.max(0, Math.floor((deadlineMs - now.getTime()) / 1000));

    let status: AttemptStatus = "in_progress";
    if (attempt.submittedAt !== null) {
      status = "submitted";
    } else if (remainingSeconds === 0 && now.getTime() >= deadlineMs) {
      status = "expired";
    }

    const gradesReleased = quiz.gradeRelease
      ? isGradeReleased(
          {
            gradeRelease: quiz.gradeRelease,
            closesAt: quiz.closesAt ?? null,
            gradesReleasedAt: quiz.gradesReleasedAt ?? null,
            allSubmitted,
          },
          now,
        )
      : false;

    const score = gradesReleased ? (attempt.score ?? null) : null;
    const percentage =
      gradesReleased && attempt.score !== null && attempt.maxScore > 0
        ? Math.round((attempt.score / attempt.maxScore) * 10000) / 100
        : gradesReleased && attempt.score !== null && attempt.maxScore === 0
          ? 100
          : null;
    const passed = gradesReleased ? (attempt.passed ?? null) : null;

    return {
      id: attempt.id,
      quizId: attempt.quizId,
      quizTitle: quiz.title,
      attemptNo: attempt.attemptNo,
      startedAt: attempt.startedAt.toISOString(),
      deadlineAt: attempt.deadlineAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      serverTime: now.toISOString(),
      remainingSeconds,
      extraTimeSec: attempt.extraTimeSec,
      status,
      navigation: quiz.navigation,
      maxScore: attempt.maxScore,
      totalQuestions: questions.length,
      resumed,
      questions,
      gradesReleased,
      score,
      percentage,
      passed,
    };
  }

  async checkAllSubmitted(quizId: string, courseId: string): Promise<boolean> {
    const activeStudentEnrollments = await this.db.enrollment.findMany({
      where: {
        courseId,
        status: "active",
        membership: {
          status: "active",
          role: "student",
        },
      },
      select: { membershipId: true },
    });

    if (activeStudentEnrollments.length === 0) {
      return true;
    }

    const membershipIds = activeStudentEnrollments.map((e) => e.membershipId);
    const submittedAttempts = await this.db.attempt.groupBy({
      by: ["membershipId"],
      where: {
        quizId,
        membershipId: { in: membershipIds },
        submittedAt: { not: null },
      },
    });

    return submittedAttempts.length >= membershipIds.length;
  }

  async getReview(
    attemptId: string,
    _user: AuthUser,
    _session: AuthSession,
    membership: Membership,
  ): Promise<AttemptReviewResponseDto> {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "No tenant context found.",
      });
    }

    const attempt = await this.db.attempt.findUnique({
      where: { id: attemptId },
      include: {
        quiz: true,
        answers: true,
      },
    });

    if (!attempt) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    const isStaff = membership?.role === "teacher" || membership?.role === "assistant";

    // Non-staff must own the attempt
    if (!isStaff && attempt.membershipId !== membership.id) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    const now = new Date();
    let currentAttempt = attempt;

    // Auto-submit if deadline expired and still in_progress
    if (currentAttempt.submittedAt === null) {
      const graceSec = currentAttempt.quiz.graceSec ?? ATTEMPT_GRACE_PERIOD_SEC;
      const deadlineMs = currentAttempt.deadlineAt.getTime() + (currentAttempt.extraTimeSec ?? 0) * 1000;
      const deadlineWithGraceMs = deadlineMs + graceSec * 1000;

      if (now.getTime() > deadlineWithGraceMs) {
        const nominalDeadline = new Date(deadlineMs);
        currentAttempt = (await this.finalizeAttempt(
          currentAttempt.id,
          nominalDeadline,
          true,
        )) as typeof attempt;
        const answers = await this.db.attemptAnswer.findMany({ where: { attemptId: currentAttempt.id } });
        currentAttempt.answers = answers;
      } else {
        throw new BadRequestException({
          statusCode: 400,
          reason: AttemptReasonCode.ATTEMPT_NOT_SUBMITTED,
          message: "Attempt has not been submitted yet.",
        });
      }
    }

    // For staff, review is always unlocked in full mode
    if (isStaff) {
      return this.buildReviewResponse(currentAttempt, currentAttempt.quiz, "full");
    }

    // For students, check grade release & review release
    let allSubmitted = false;
    if (currentAttempt.quiz.gradeRelease === "all_submitted") {
      allSubmitted = await this.checkAllSubmitted(currentAttempt.quiz.id, currentAttempt.quiz.courseId);
    }

    const gradesReleased = isGradeReleased(
      {
        gradeRelease: currentAttempt.quiz.gradeRelease,
        closesAt: currentAttempt.quiz.closesAt,
        gradesReleasedAt: currentAttempt.quiz.gradesReleasedAt,
        allSubmitted,
      },
      now,
    );

    const reviewReleased = isReviewReleased(
      { reviewReleaseAt: currentAttempt.quiz.reviewReleaseAt },
      gradesReleased,
      now,
    );

    if (!reviewReleased) {
      throw new ForbiddenException({
        statusCode: 403,
        reason: AttemptReasonCode.REVIEW_NOT_RELEASED,
        message: "Review is not released yet.",
      });
    }

    return this.buildReviewResponse(currentAttempt, currentAttempt.quiz, currentAttempt.quiz.reviewMode);
  }

  private buildReviewResponse(
    attempt: Attempt & { quiz: Quiz; answers: AttemptAnswer[] },
    quiz: Quiz,
    reviewMode: ReviewMode,
  ): AttemptReviewResponseDto {
    const maxScore = attempt.maxScore;
    const score = attempt.score ?? 0;
    const percentage =
      maxScore > 0 ? Math.round((score / maxScore) * 10000) / 100 : 100;
    const passed = attempt.passed ?? false;

    if (reviewMode === "grade") {
      return {
        attemptId: attempt.id,
        quizId: attempt.quizId,
        quizTitle: quiz.title,
        attemptNo: attempt.attemptNo,
        status: "submitted",
        submittedAt: attempt.submittedAt!.toISOString(),
        reviewMode: "grade",
        score,
        maxScore,
        percentage,
        passed,
        questions: null,
      };
    }

    const snapshot = attempt.snapshot as unknown as StoredAttemptSnapshot;
    const snapshotQuestions = snapshot?.questions ?? [];
    const answerMap = new Map(attempt.answers.map((a) => [a.questionId, a]));

    const questions: ReviewQuestionDto[] = snapshotQuestions.map((q) => {
      const ans = answerMap.get(q.id);
      const selectedOptionIds = ans?.selectedOptionIds ?? [];
      const isCorrect = ans?.isCorrect ?? false;
      const marksAwarded = ans?.marksAwarded ?? 0;

      const options = (q.options ?? []).map((opt) => ({
        id: opt.id,
        text: opt.text,
        isCorrect: opt.isCorrect,
      }));

      const explanation = reviewMode === "full" ? (q.explanation ?? null) : null;

      return {
        id: q.id,
        text: q.text,
        type: q.type,
        marks: q.marks,
        imageAssetId: q.imageAssetId ?? null,
        selectedOptionIds,
        isCorrect,
        marksAwarded,
        explanation,
        options,
      };
    });

    return {
      attemptId: attempt.id,
      quizId: attempt.quizId,
      quizTitle: quiz.title,
      attemptNo: attempt.attemptNo,
      status: "submitted",
      submittedAt: attempt.submittedAt!.toISOString(),
      reviewMode,
      score,
      maxScore,
      percentage,
      passed,
      questions,
    };
  }

  async extendTime(
    attemptId: string,
    input: AttemptExtendTimeDto,
    user: AuthUser,
    _membership?: Membership,
  ): Promise<AttemptExtendTimeResponseDto> {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "No tenant context found.",
      });
    }

    const attempt = await this.db.attempt.findUnique({
      where: { id: attemptId },
      include: { quiz: true, membership: true },
    });

    if (!attempt) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    const secondsToAdd = input.extraTimeSec ?? input.extraMinutes! * 60;
    const now = new Date();
    const isAlreadySubmitted = attempt.submittedAt !== null;

    if (isAlreadySubmitted && !input.reopen) {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.ATTEMPT_ALREADY_SUBMITTED,
        message: "Attempt has already been submitted and reopen was not requested.",
      });
    }

    if (isAlreadySubmitted && input.reopen) {
      let allSubmitted = false;
      if (attempt.quiz.gradeRelease === "all_submitted") {
        allSubmitted = await this.checkAllSubmitted(attempt.quiz.id, attempt.quiz.courseId);
      }
      const gradesReleased = isGradeReleased(
        {
          gradeRelease: attempt.quiz.gradeRelease,
          closesAt: attempt.quiz.closesAt,
          gradesReleasedAt: attempt.quiz.gradesReleasedAt,
          allSubmitted,
        },
        now,
      );
      const reviewReleased = isReviewReleased(
        { reviewReleaseAt: attempt.quiz.reviewReleaseAt },
        gradesReleased,
        now,
      );

      if (reviewReleased) {
        throw new BadRequestException({
          statusCode: 400,
          reason: AttemptReasonCode.ATTEMPT_CANNOT_REOPEN,
          message:
            "Cannot reopen attempt because answers and review have already been released.",
        });
      }
    }

    const result = await this.db.$transaction(async (tx) => {
      const current = await tx.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { quiz: true },
      });

      const newExtraTimeSec = current.extraTimeSec + secondsToAdd;
      const wasReopened = isAlreadySubmitted && input.reopen;

      const updateData: {
        extraTimeSec: number;
        submittedAt?: null;
        score?: null;
        passed?: null;
      } = {
        extraTimeSec: newExtraTimeSec,
      };

      if (wasReopened) {
        updateData.submittedAt = null;
        updateData.score = null;
        updateData.passed = null;

        await tx.attemptAnswer.updateMany({
          where: { attemptId: current.id },
          data: {
            isCorrect: null,
            marksAwarded: null,
          },
        });
      }

      const updated = await tx.attempt.update({
        where: { id: current.id },
        data: updateData,
        include: { quiz: true },
      });

      await this.audit.record(
        {
          action: "attempt.extend_time",
          targetType: "attempt",
          targetId: updated.id,
          actorUserId: user.id,
          meta: {
            quizId: updated.quizId,
            studentMembershipId: updated.membershipId,
            secondsAdded: secondsToAdd,
            previousExtraTimeSec: current.extraTimeSec,
            newExtraTimeSec,
            reopened: wasReopened,
            reason: input.reason ?? null,
          },
        },
        tx,
      );

      return { updated, wasReopened, newExtraTimeSec };
    });

    const effectiveDeadlineMs =
      result.updated.deadlineAt.getTime() + result.newExtraTimeSec * 1000;
    const effectiveDeadlineAt = new Date(effectiveDeadlineMs);

    let status: AttemptStatus = "in_progress";
    if (result.updated.submittedAt !== null) {
      status = "submitted";
    } else if (now.getTime() >= effectiveDeadlineMs) {
      status = "expired";
    }

    return {
      success: true,
      attemptId: result.updated.id,
      extraTimeSec: result.newExtraTimeSec,
      deadlineAt: result.updated.deadlineAt.toISOString(),
      effectiveDeadlineAt: effectiveDeadlineAt.toISOString(),
      status,
      reopened: result.wasReopened,
    };
  }

  async moveDevice(
    attemptId: string,
    input: AttemptMoveDeviceDto,
    user: AuthUser,
    _membership?: Membership,
  ): Promise<AttemptMoveDeviceResponseDto> {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new ForbiddenException({
        statusCode: 403,
        reason: "NO_ACCESS",
        message: "No tenant context found.",
      });
    }

    const attempt = await this.db.attempt.findUnique({
      where: { id: attemptId },
      include: { membership: true },
    });

    if (!attempt) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.ATTEMPT_NOT_FOUND,
        message: "Attempt not found.",
      });
    }

    const targetDeviceId = input.newDeviceId ?? input.deviceId!;

    const targetDevice = await this.db.device.findUnique({
      where: { id: targetDeviceId },
    });

    if (!targetDevice || targetDevice.userId !== attempt.membership.userId) {
      throw new NotFoundException({
        statusCode: 404,
        reason: AttemptReasonCode.DEVICE_NOT_FOUND,
        message: "Device not found for this student.",
      });
    }

    if (targetDevice.status !== "active") {
      throw new BadRequestException({
        statusCode: 400,
        reason: AttemptReasonCode.INVALID_DEVICE_STATUS,
        message: "Target device is not active.",
      });
    }

    const previousDeviceId = attempt.deviceId;

    await this.db.$transaction(async (tx) => {
      await tx.attempt.update({
        where: { id: attempt.id },
        data: { deviceId: targetDeviceId },
      });

      await tx.session.deleteMany({
        where: {
          userId: attempt.membership.userId,
          deviceId: previousDeviceId,
        },
      });

      await this.audit.record(
        {
          action: "attempt.move_device",
          targetType: "attempt",
          targetId: attempt.id,
          actorUserId: user.id,
          meta: {
            quizId: attempt.quizId,
            studentMembershipId: attempt.membershipId,
            studentUserId: attempt.membership.userId,
            previousDeviceId,
            newDeviceId: targetDeviceId,
            reason: input.reason ?? null,
          },
        },
        tx,
      );
    });

    return {
      success: true,
      attemptId: attempt.id,
      previousDeviceId,
      newDeviceId: targetDeviceId,
    };
  }
}
