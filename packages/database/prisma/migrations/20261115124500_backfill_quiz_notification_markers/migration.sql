-- Step 10.1: quizzes that already opened or released before the scheduler existed must not
-- trigger a burst of "exam opening" / "grades released" notifications on the first job run.
UPDATE "quizzes"
SET "opening_notified_at" = now()
WHERE "opening_notified_at" IS NULL
  AND "opens_at" <= now();

UPDATE "quizzes"
SET "release_notified_at" = now()
WHERE "release_notified_at" IS NULL
  AND (
    "grades_released_at" IS NOT NULL
    OR ("grade_release" IN ('on_close', 'all_submitted') AND "closes_at" <= now())
  );
