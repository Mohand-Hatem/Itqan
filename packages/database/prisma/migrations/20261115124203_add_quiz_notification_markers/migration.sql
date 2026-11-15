-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "opening_notified_at" TIMESTAMPTZ,
ADD COLUMN     "release_notified_at" TIMESTAMPTZ;
