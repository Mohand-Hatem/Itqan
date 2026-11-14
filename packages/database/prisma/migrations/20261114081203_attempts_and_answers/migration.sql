-- CreateTable
CREATE TABLE "attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMPTZ NOT NULL,
    "submitted_at" TIMESTAMPTZ,
    "extra_time_sec" INTEGER NOT NULL DEFAULT 0,
    "max_score" DOUBLE PRECISION NOT NULL,
    "score" DOUBLE PRECISION,
    "passed" BOOLEAN,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attempt_answers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "selected_option_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "is_correct" BOOLEAN,
    "marks_awarded" DOUBLE PRECISION,
    "saved_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attempts_tenant_id_quiz_id_membership_id_idx" ON "attempts"("tenant_id", "quiz_id", "membership_id");

-- CreateIndex
CREATE INDEX "attempts_tenant_id_membership_id_started_at_idx" ON "attempts"("tenant_id", "membership_id", "started_at");

-- CreateIndex
CREATE INDEX "attempts_tenant_id_submitted_at_deadline_at_idx" ON "attempts"("tenant_id", "submitted_at", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_quiz_id_membership_id_attempt_no_key" ON "attempts"("quiz_id", "membership_id", "attempt_no");

-- CreateIndex
CREATE INDEX "attempt_answers_tenant_id_attempt_id_idx" ON "attempt_answers"("tenant_id", "attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "attempt_answers_attempt_id_question_id_key" ON "attempt_answers"("attempt_id", "question_id");

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attempt_answers" ADD CONSTRAINT "attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
