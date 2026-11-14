-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "grace_sec" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "grades_released_at" TIMESTAMPTZ,
ADD COLUMN     "review_release_at" TIMESTAMPTZ;
