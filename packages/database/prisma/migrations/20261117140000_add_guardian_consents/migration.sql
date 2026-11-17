-- 10R.7 (FR-A06, ADR-014): guardian consent once per person, by email link or offline form.
-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'given', 'withdrawn');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('electronic_email', 'offline', 'legacy_checkbox');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('parent', 'legal_guardian', 'other');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_minor" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "guardian_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "guardian_name" TEXT,
    "guardian_relationship" "GuardianRelationship",
    "guardian_email" TEXT,
    "token_hash" TEXT,
    "expires_at" TIMESTAMPTZ,
    "obtained_at" TIMESTAMPTZ,
    "recorded_by_user_id" UUID,
    "recorded_tenant_id" UUID,
    "evidence_reference" TEXT,
    "notes" TEXT,
    "policy_version" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "guardian_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guardian_consents_token_hash_key" ON "guardian_consents"("token_hash");

-- CreateIndex
CREATE INDEX "guardian_consents_user_id_status_idx" ON "guardian_consents"("user_id", "status");

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_recorded_tenant_id_fkey" FOREIGN KEY ("recorded_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Keep every old consent as history. The old checkbox was ticked by the student, which is not a
-- guardian's consent (ADR-014), so these rows never open the access gate; one per person, earliest
-- first, with the academy where it was recorded. Those people are marked as minors.
INSERT INTO "guardian_consents"
  ("id", "user_id", "status", "method", "obtained_at", "recorded_tenant_id", "evidence_reference", "updated_at")
SELECT DISTINCT ON (m."user_id")
  gen_random_uuid(), m."user_id", 'given', 'legacy_checkbox', m."guardian_consent_at", m."tenant_id",
  'memberships.guardian_consent_at', now()
FROM "memberships" m
WHERE m."guardian_consent_at" IS NOT NULL
ORDER BY m."user_id", m."guardian_consent_at";

UPDATE "users"
SET "is_minor" = true
WHERE "id" IN (SELECT "user_id" FROM "guardian_consents" WHERE "method" = 'legacy_checkbox');
