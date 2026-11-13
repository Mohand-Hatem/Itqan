import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getRequestContext, type MediaAsset, type ScopedPrismaClient } from "@itqan/database";
import {
  type MediaAssetResponse,
  type UploadCreateInput,
  type UploadCreateResponse,
  type UploadPatchInput,
  UploadReasonCode,
  uploadRejection,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { type BucketName, StorageService, tenantKey } from "../storage/storage.service.js";

const bucketOf = (asset: Pick<MediaAsset, "purpose">): BucketName =>
  asset.purpose === "public" ? "public" : "private";

// fileSize is a bigint in Postgres; JSON has no bigint. 5 GB fits a JS number exactly.
const toResponse = (a: MediaAsset): MediaAssetResponse => ({
  id: a.id,
  purpose: a.purpose,
  originalName: a.originalName,
  mimeType: a.mimeType,
  fileSize: Number(a.fileSize),
  status: a.status,
  downloadPolicy: a.downloadPolicy,
  createdAt: a.createdAt.toISOString(),
});

/** Direct-to-R2 uploads (step 7.2, docs/06-flows.md §4). File bytes never reach this server. */
@Injectable()
export class UploadsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async create(input: UploadCreateInput, userId: string): Promise<UploadCreateResponse> {
    const reason = uploadRejection(input);
    if (reason) {
      throw new BadRequestException({
        statusCode: 400,
        reason,
        message:
          reason === UploadReasonCode.UPLOAD_TOO_LARGE
            ? "The file is larger than the limit for its type."
            : "This file type is not allowed here.",
      });
    }
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "No tenant context found in request",
      });
    }
    const { tenantId } = ctx;

    // The key holds the asset id, which the database generates (uuidv7): insert, then set the key.
    const asset = await this.db.$transaction(async (tx) => {
      const row = await tx.mediaAsset.create({
        data: {
          tenantId,
          purpose: input.purpose,
          storageKey: `pending/${randomUUID()}`,
          originalName: input.fileName,
          mimeType: input.mimeType,
          fileSize: BigInt(input.size),
          downloadPolicy: input.downloadPolicy,
          uploadedBy: userId,
        },
      });
      return tx.mediaAsset.update({
        where: { id: row.id },
        data: { storageKey: tenantKey(tenantId, row.id) },
      });
    });

    const { url, expiresAt } = await this.storage.presignPut(bucketOf(asset), asset.storageKey, {
      contentType: asset.mimeType,
      contentLength: input.size,
    });
    return { asset: toResponse(asset), uploadUrl: url, expiresAt: expiresAt.toISOString() };
  }

  /** Checks the stored object with HEAD and marks the asset ready. Safe to call twice. */
  async confirm(id: string, userId: string): Promise<MediaAssetResponse> {
    const asset = await this.db.mediaAsset.findFirst({ where: { id } });
    if (!asset) {
      throw new NotFoundException({
        statusCode: 404,
        reason: UploadReasonCode.ASSET_NOT_FOUND,
        message: "File not found.",
      });
    }
    if (asset.status === "ready") return toResponse(asset);
    if (asset.status === "failed") throw this.mismatch();

    const bucket = bucketOf(asset);
    const stored = await this.storage.head(bucket, asset.storageKey);
    if (!stored) {
      throw new ConflictException({
        statusCode: 409,
        reason: UploadReasonCode.UPLOAD_NOT_FOUND,
        message: "The file has not been uploaded yet.",
      });
    }
    if (stored.size !== Number(asset.fileSize) || stored.contentType !== asset.mimeType) {
      await this.db.mediaAsset.updateMany({
        where: { id, status: "pending" },
        data: { status: "failed" },
      });
      await this.storage.delete(bucket, asset.storageKey);
      throw this.mismatch();
    }

    return this.db.$transaction(async (tx) => {
      // Only the call that flips pending → ready writes the audit entry.
      const { count } = await tx.mediaAsset.updateMany({
        where: { id, status: "pending" },
        data: { status: "ready" },
      });
      if (count === 1) {
        await this.audit.record(
          {
            action: "media.upload",
            targetType: "media_asset",
            targetId: id,
            actorUserId: userId,
            meta: {
              purpose: asset.purpose,
              mimeType: asset.mimeType,
              fileSize: Number(asset.fileSize),
            },
          },
          tx,
        );
      }
      return toResponse(await tx.mediaAsset.findFirstOrThrow({ where: { id } }));
    });
  }

  /** View-only or downloadable (step 7.6, FR-C04). Applies to every item that uses the file. */
  async setDownloadPolicy(
    id: string,
    input: UploadPatchInput,
    userId: string,
  ): Promise<MediaAssetResponse> {
    return this.db.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.findFirst({ where: { id } });
      if (!asset) {
        throw new NotFoundException({
          statusCode: 404,
          reason: UploadReasonCode.ASSET_NOT_FOUND,
          message: "File not found.",
        });
      }
      if (asset.downloadPolicy === input.downloadPolicy) return toResponse(asset);
      const updated = await tx.mediaAsset.update({
        where: { id },
        data: { downloadPolicy: input.downloadPolicy },
      });
      await this.audit.record(
        {
          action: "media.update",
          targetType: "media_asset",
          targetId: id,
          actorUserId: userId,
          meta: { downloadPolicy: { from: asset.downloadPolicy, to: input.downloadPolicy } },
        },
        tx,
      );
      return toResponse(updated);
    });
  }

  private mismatch() {
    return new ConflictException({
      statusCode: 409,
      reason: UploadReasonCode.UPLOAD_MISMATCH,
      message: "The uploaded file does not match. Upload it again.",
    });
  }
}
