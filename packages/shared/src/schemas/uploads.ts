import { z } from "zod";

const MB = 1024 * 1024;

/** Allowed upload types and their size limits (docs/06-flows.md §4, FR-C03). No SVG: it can carry scripts. */
export const UPLOAD_LIMITS: Readonly<Record<string, number>> = {
  "application/pdf": 100 * MB,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": 100 * MB,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": 100 * MB,
  "image/jpeg": 10 * MB,
  "image/png": 10 * MB,
  "image/webp": 10 * MB,
  "video/mp4": 5 * 1024 * MB,
};

export const UploadReasonCode = {
  UPLOAD_TYPE_NOT_ALLOWED: "UPLOAD_TYPE_NOT_ALLOWED",
  UPLOAD_TOO_LARGE: "UPLOAD_TOO_LARGE",
  /** confirm: the file is not in storage (not uploaded yet, or the upload failed). */
  UPLOAD_NOT_FOUND: "UPLOAD_NOT_FOUND",
  /** confirm: the stored file's size or type differs from what was declared; the asset is failed. */
  UPLOAD_MISMATCH: "UPLOAD_MISMATCH",
  ASSET_NOT_FOUND: "ASSET_NOT_FOUND",
} as const;
export type UploadReasonCode = (typeof UploadReasonCode)[keyof typeof UploadReasonCode];

export const MediaPurposeSchema = z.enum(["content", "public"]);
export const DownloadPolicySchema = z.enum(["view_only", "downloadable"]);

export const UploadCreateSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    // eslint-disable-next-line no-control-regex -- control characters break Content-Disposition later
    .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), "Invalid file name"),
  mimeType: z.string().trim().toLowerCase().min(1).max(255),
  size: z.number().int().positive(),
  purpose: MediaPurposeSchema,
  downloadPolicy: DownloadPolicySchema.default("view_only"),
});
export type UploadCreateInput = z.infer<typeof UploadCreateSchema>;

/** Why a declared file is refused, or null when it is allowed. */
export function uploadRejection(
  input: Pick<UploadCreateInput, "mimeType" | "size" | "purpose">,
): UploadReasonCode | null {
  const limit = UPLOAD_LIMITS[input.mimeType];
  if (limit === undefined) return UploadReasonCode.UPLOAD_TYPE_NOT_ALLOWED;
  // The public bucket serves files from a public URL: images only.
  if (input.purpose === "public" && !input.mimeType.startsWith("image/")) {
    return UploadReasonCode.UPLOAD_TYPE_NOT_ALLOWED;
  }
  if (input.size > limit) return UploadReasonCode.UPLOAD_TOO_LARGE;
  return null;
}

export type MediaAssetResponse = {
  id: string;
  purpose: z.infer<typeof MediaPurposeSchema>;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: "pending" | "ready" | "failed";
  downloadPolicy: z.infer<typeof DownloadPolicySchema>;
  createdAt: string;
};

export type UploadCreateResponse = {
  asset: MediaAssetResponse;
  uploadUrl: string;
  expiresAt: string;
};

/** PATCH /uploads/:id (step 7.6): view-only or downloadable. */
export const UploadPatchSchema = z.object({ downloadPolicy: DownloadPolicySchema }).strict();
export type UploadPatchInput = z.infer<typeof UploadPatchSchema>;
