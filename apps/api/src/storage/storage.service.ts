import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type R2Config, loadR2Config } from "./r2-config.js";

/** A presigned PUT lives 15 minutes (docs/03 §4). */
export const PRESIGN_PUT_SECONDS = 15 * 60;

/** Presigned GET lifetimes (docs/03 §4): documents 5 minutes, videos 4 hours. */
export const PRESIGN_GET_DOC_SECONDS = 5 * 60;
export const PRESIGN_GET_VIDEO_SECONDS = 4 * 60 * 60;

export type BucketName = "private" | "public";

/**
 * Content-Disposition for a stored file. Non-ASCII names (Arabic) go in filename* (RFC 6266);
 * the plain filename is an ASCII stand-in for old clients.
 */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Object key of a tenant's asset: tenants/{tenantId}/{assetId} (docs/03 §4). */
export function tenantKey(tenantId: string, assetId: string): string {
  if (!UUID.test(tenantId) || !UUID.test(assetId)) {
    throw new Error("tenantKey needs a tenant id and an asset id (uuids).");
  }
  return `tenants/${tenantId}/${assetId}`;
}

/**
 * Cloudflare R2 through its S3 API (step 7.1). File bytes never pass through our server: the
 * browser uploads and downloads with presigned URLs. The config loads on first use, so the app
 * and the tests start without R2 keys. Provided by StorageModule.
 */
export class StorageService {
  private r2?: { config: R2Config; client: S3Client };

  constructor(private readonly loadConfig: () => R2Config = () => loadR2Config()) {}

  private get() {
    if (!this.r2) {
      const config = this.loadConfig();
      const client = new S3Client({
        region: "auto", // required by the SDK, ignored by R2
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
        // The SDK would add checksums the browser cannot send with a presigned PUT.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
      this.r2 = { config, client };
    }
    return this.r2;
  }

  /** A URL that allows one PUT of `key` with exactly this content type (and size, if given), for 15 minutes. */
  async presignPut(
    bucket: BucketName,
    key: string,
    opts: { contentType: string; contentLength?: number },
  ) {
    const { config, client } = this.get();
    const command = new PutObjectCommand({
      Bucket: config.buckets[bucket],
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.contentLength,
    });
    const url = await getSignedUrl(client, command, {
      expiresIn: PRESIGN_PUT_SECONDS,
      // Sign Content-Type and Content-Length so the upload must send the type and size the API
      // allowed (403 otherwise).
      signableHeaders: new Set(
        opts.contentLength === undefined ? ["content-type"] : ["content-type", "content-length"],
      ),
    });
    return { url, expiresAt: new Date(Date.now() + PRESIGN_PUT_SECONDS * 1000) };
  }

  /**
   * A URL that allows GETs of `key` for `expiresIn` seconds. R2 answers with the given type and
   * Content-Disposition, whatever was stored, so a file is never rendered as something else.
   */
  async presignGet(
    bucket: BucketName,
    key: string,
    opts: { expiresIn: number; contentType: string; disposition: string },
  ) {
    const { config, client } = this.get();
    const command = new GetObjectCommand({
      Bucket: config.buckets[bucket],
      Key: key,
      ResponseContentType: opts.contentType,
      ResponseContentDisposition: opts.disposition,
    });
    const url = await getSignedUrl(client, command, { expiresIn: opts.expiresIn });
    return { url, expiresAt: new Date(Date.now() + opts.expiresIn * 1000) };
  }

  /** Size and type of an object, or null when it does not exist. */
  async head(bucket: BucketName, key: string) {
    const { config, client } = this.get();
    try {
      const res = await client.send(
        new HeadObjectCommand({ Bucket: config.buckets[bucket], Key: key }),
      );
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (e) {
      if (e instanceof NotFound || (e as { name?: string }).name === "NotFound") return null;
      throw e;
    }
  }

  async delete(bucket: BucketName, key: string) {
    const { config, client } = this.get();
    await client.send(new DeleteObjectCommand({ Bucket: config.buckets[bucket], Key: key }));
  }

  /** Public URL of an object in the public bucket (logos, thumbnails). */
  publicUrl(key: string) {
    return `${this.get().config.publicUrl}/${key}`;
  }
}
