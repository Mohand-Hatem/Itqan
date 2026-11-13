-- CreateTable
CREATE TABLE "access_code_batches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "name" TEXT,
    "code_count" INTEGER NOT NULL,
    "redeemed_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "revoked_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "access_code_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "serial_number" INTEGER NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_prefix" TEXT NOT NULL,
    "redeemed_at" TIMESTAMPTZ,
    "redeemed_by" UUID,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_code_batches_tenant_id_course_id_created_at_idx" ON "access_code_batches"("tenant_id", "course_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "access_code_batches_tenant_id_revoked_at_idx" ON "access_code_batches"("tenant_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_codes_code_hash_key" ON "access_codes"("code_hash");

-- CreateIndex
CREATE INDEX "access_codes_code_hash_idx" ON "access_codes"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "access_codes_tenant_id_batch_id_serial_number_key" ON "access_codes"("tenant_id", "batch_id", "serial_number");

-- CreateIndex
CREATE INDEX "access_codes_tenant_id_batch_id_redeemed_at_revoked_at_idx" ON "access_codes"("tenant_id", "batch_id", "redeemed_at", "revoked_at");

-- AddForeignKey
ALTER TABLE "access_code_batches" ADD CONSTRAINT "access_code_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_code_batches" ADD CONSTRAINT "access_code_batches_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_code_batches" ADD CONSTRAINT "access_code_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_code_batches" ADD CONSTRAINT "access_code_batches_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "access_code_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_codes" ADD CONSTRAINT "access_codes_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
