-- CreateEnum
CREATE TYPE "QuizSelection" AS ENUM ('manual', 'random');

-- CreateEnum
CREATE TYPE "QuizNavigation" AS ENUM ('free', 'linear');

-- CreateEnum
CREATE TYPE "GradeRelease" AS ENUM ('on_submit', 'all_submitted', 'on_close', 'manual');

-- CreateEnum
CREATE TYPE "ReviewMode" AS ENUM ('grade', 'grade_answers', 'full');

-- AlterEnum
ALTER TYPE "ContentKind" ADD VALUE 'quiz';

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "quiz_id" UUID;

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "duration_min" INTEGER NOT NULL,
    "pass_mark" DOUBLE PRECISION NOT NULL,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "selection" "QuizSelection" NOT NULL DEFAULT 'manual',
    "random_count" INTEGER,
    "random_bank_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "shuffle_questions" BOOLEAN NOT NULL DEFAULT false,
    "shuffle_options" BOOLEAN NOT NULL DEFAULT false,
    "navigation" "QuizNavigation" NOT NULL DEFAULT 'free',
    "grade_release" "GradeRelease" NOT NULL DEFAULT 'on_submit',
    "review_mode" "ReviewMode" NOT NULL DEFAULT 'full',
    "opens_at" TIMESTAMPTZ NOT NULL,
    "closes_at" TIMESTAMPTZ,
    "published_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_targets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "content_item_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quizzes_tenant_id_course_id_deleted_at_idx" ON "quizzes"("tenant_id", "course_id", "deleted_at");

-- CreateIndex
CREATE INDEX "quizzes_tenant_id_deleted_at_idx" ON "quizzes"("tenant_id", "deleted_at");

-- CreateIndex
CREATE INDEX "quiz_targets_tenant_id_quiz_id_idx" ON "quiz_targets"("tenant_id", "quiz_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_targets_quiz_id_content_item_id_key" ON "quiz_targets"("quiz_id", "content_item_id");

-- CreateIndex
CREATE INDEX "quiz_questions_tenant_id_quiz_id_sort_order_idx" ON "quiz_questions"("tenant_id", "quiz_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_questions_quiz_id_question_id_key" ON "quiz_questions"("quiz_id", "question_id");

-- CreateIndex
CREATE INDEX "content_items_quiz_id_idx" ON "content_items"("quiz_id");

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_targets" ADD CONSTRAINT "quiz_targets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_targets" ADD CONSTRAINT "quiz_targets_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_targets" ADD CONSTRAINT "quiz_targets_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
