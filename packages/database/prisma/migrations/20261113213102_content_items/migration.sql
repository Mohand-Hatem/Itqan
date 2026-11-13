-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('folder', 'chapter', 'lecture', 'file', 'video');

-- CreateTable
CREATE TABLE "content_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" "ContentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "asset_id" UUID,
    "published_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_items_tenant_id_course_id_idx" ON "content_items"("tenant_id", "course_id");

-- CreateIndex
CREATE INDEX "content_items_course_id_parent_id_sort_order_idx" ON "content_items"("course_id", "parent_id", "sort_order");

-- CreateIndex
CREATE INDEX "content_items_asset_id_idx" ON "content_items"("asset_id");

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
