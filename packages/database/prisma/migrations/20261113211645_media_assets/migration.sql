-- CreateEnum
CREATE TYPE "MediaProvider" AS ENUM ('r2');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('pending', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "DownloadPolicy" AS ENUM ('view_only', 'downloadable');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('content', 'public');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "MediaProvider" NOT NULL DEFAULT 'r2',
    "purpose" "MediaPurpose" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "duration_sec" INTEGER,
    "status" "MediaStatus" NOT NULL DEFAULT 'pending',
    "download_policy" "DownloadPolicy" NOT NULL DEFAULT 'view_only',
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_tenant_id_status_created_at_idx" ON "media_assets"("tenant_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
