// Pure deterministic grading engine for exam attempts (Step 8.7, FR-X06)
// Zero I/O, zero async operations, zero ORM or framework dependencies.

import type { GradeRelease, StoredAttemptQuestion } from "@itqan/shared";

export interface GradedQuestionResult {
  questionId: string;
  selectedOptionIds: string[];
  isCorrect: boolean;
  marksAwarded: number;
}

export interface AttemptGradingResult {
  score: number;
  maxScore: number;
  percentage: number;
  passed: boolean;
  answers: GradedQuestionResult[];
}

/**
 * Pure evaluation function: computes grades per question and aggregates scores
 * with drift-free floating-point rounding.
 */
export function gradeAttempt(
  snapshotQuestions: StoredAttemptQuestion[],
  savedAnswers: Array<{ questionId: string; selectedOptionIds: string[] }>,
  passMark: number,
  maxScoreOverride?: number,
): AttemptGradingResult {
  const answerMap = new Map<string, string[]>();
  for (const ans of savedAnswers) {
    // Deduplicate option IDs per answer
    answerMap.set(ans.questionId, Array.from(new Set(ans.selectedOptionIds)));
  }

  let rawTotalScore = 0;

  const gradedAnswers: GradedQuestionResult[] = snapshotQuestions.map((q) => {
    const selected = answerMap.get(q.id) ?? [];
    let isCorrect = false;

    if (q.type === "single" || q.type === "true_false") {
      const correctOpt = q.options.find((o) => o.isCorrect);
      isCorrect = Boolean(correctOpt && selected.length === 1 && selected[0] === correctOpt.id);
    } else if (q.type === "multiple") {
      const correctOptionIds = q.options.filter((o) => o.isCorrect).map((o) => o.id);
      if (correctOptionIds.length > 0) {
        const correctSet = new Set(correctOptionIds);
        const selectedSet = new Set(selected);
        isCorrect =
          selectedSet.size === correctSet.size &&
          correctOptionIds.every((id) => selectedSet.has(id));
      }
    }

    const questionMarks = q.marks ?? 1;
    const marksAwarded = isCorrect ? Math.round(questionMarks * 100) / 100 : 0;
    rawTotalScore += marksAwarded;

    return {
      questionId: q.id,
      selectedOptionIds: selected,
      isCorrect,
      marksAwarded,
    };
  });

  const rawMaxScore =
    maxScoreOverride ?? snapshotQuestions.reduce((sum, q) => sum + (q.marks ?? 1), 0);
  const maxScore = Math.round(rawMaxScore * 100) / 100;
  const score = Math.round(rawTotalScore * 100) / 100;

  let percentage: number;
  let passed: boolean;

  if (maxScore <= 0) {
    percentage = passMark === 0 ? 100 : 0;
    passed = passMark === 0;
  } else if (score >= maxScore) {
    percentage = 100;
    passed = true;
  } else {
    percentage = Math.round((score / maxScore) * 10000) / 100;
    passed = percentage >= passMark;
  }

  return {
    score,
    maxScore,
    percentage,
    passed,
    answers: gradedAnswers,
  };
}

export interface GradeReleaseContext {
  gradeRelease: GradeRelease;
  closesAt: Date | null;
  gradesReleasedAt?: Date | null;
  allSubmitted?: boolean;
}

/**
 * Determines whether grades should be visible to a student.
 * Before release, students see at most their score (or nothing if hidden).
 */
export function isGradeReleased(
  quiz: GradeReleaseContext,
  now: Date = new Date(),
): boolean {
  // If staff explicitly released grades at a timestamp:
  if (quiz.gradesReleasedAt && now.getTime() >= quiz.gradesReleasedAt.getTime()) {
    return true;
  }

  if (quiz.gradeRelease === "on_submit") {
    return true;
  }

  if (quiz.gradeRelease === "on_close") {
    return Boolean(quiz.closesAt && now.getTime() >= quiz.closesAt.getTime());
  }

  if (quiz.gradeRelease === "all_submitted") {
    // Falls back to close time if defined and elapsed
    if (quiz.closesAt && now.getTime() >= quiz.closesAt.getTime()) {
      return true;
    }
    return Boolean(quiz.allSubmitted);
  }

  if (quiz.gradeRelease === "manual") {
    return Boolean(quiz.gradesReleasedAt && now.getTime() >= quiz.gradesReleasedAt.getTime());
  }

  return false;
}

export interface ReviewReleaseContext {
  reviewReleaseAt: Date | null;
  closesAt: Date | null;
  gradesReleasedAt: Date | null;
}

/**
 * Whether students may see review (correct answers, explanations). docs/06-flows.md section 7:
 * review_release_at decides when, default closes_at, so nobody reads the answer key while
 * classmates are still inside the exam window. A quiz with neither time opens review only once
 * staff release grades by hand; "grades on submit" alone never does.
 */
export function isReviewReleased(quiz: ReviewReleaseContext, now: Date = new Date()): boolean {
  const at = quiz.reviewReleaseAt ?? quiz.closesAt ?? quiz.gradesReleasedAt;
  return at !== null && now.getTime() >= at.getTime();
}
