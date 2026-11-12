-- CreateEnum
CREATE TYPE "SupportRequestType" AS ENUM ('device_change', 'sign_out_other', 'general');

-- CreateEnum
CREATE TYPE "SupportRequestStatus" AS ENUM ('open', 'approved', 'rejected', 'closed');

-- CreateTable
CREATE TABLE "support_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "type" "SupportRequestType" NOT NULL,
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'open',
    "message" TEXT,
    "pending_device_id" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_requests_tenant_id_status_created_at_idx" ON "support_requests"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_requests_membership_id_type_status_idx" ON "support_requests"("membership_id", "type", "status");

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_pending_device_id_fkey" FOREIGN KEY ("pending_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
