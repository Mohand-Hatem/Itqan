import { describe, expect, it } from "vitest";
import { UPLOAD_LIMITS, UploadCreateSchema, uploadRejection } from "./uploads.js";

const MB = 1024 * 1024;
const PDF = "application/pdf";

describe("uploadRejection", () => {
  it("allows each listed type up to its limit (PDF/DOCX/PPTX 100 MB, images 10 MB, MP4 5 GB)", () => {
    expect(UPLOAD_LIMITS[PDF]).toBe(100 * MB);
    expect(UPLOAD_LIMITS["image/png"]).toBe(10 * MB);
    expect(UPLOAD_LIMITS["video/mp4"]).toBe(5 * 1024 * MB);
    for (const [mimeType, limit] of Object.entries(UPLOAD_LIMITS)) {
      expect(uploadRejection({ mimeType, size: limit, purpose: "content" })).toBeNull();
      expect(uploadRejection({ mimeType, size: limit + 1, purpose: "content" })).toBe(
        "UPLOAD_TOO_LARGE",
      );
    }
  });

  it("refuses types not on the list, including SVG, GIF and HTML", () => {
    for (const mimeType of ["image/svg+xml", "image/gif", "text/html", "application/zip"]) {
      expect(uploadRejection({ mimeType, size: 10, purpose: "content" })).toBe(
        "UPLOAD_TYPE_NOT_ALLOWED",
      );
    }
  });

  it("allows only images in the public bucket", () => {
    expect(uploadRejection({ mimeType: "image/webp", size: 10, purpose: "public" })).toBeNull();
    expect(uploadRejection({ mimeType: PDF, size: 10, purpose: "public" })).toBe(
      "UPLOAD_TYPE_NOT_ALLOWED",
    );
    expect(uploadRejection({ mimeType: "video/mp4", size: 10, purpose: "public" })).toBe(
      "UPLOAD_TYPE_NOT_ALLOWED",
    );
  });
});

describe("UploadCreateSchema", () => {
  const valid = { fileName: "lesson.pdf", mimeType: PDF, size: 1000, purpose: "content" };

  it("defaults downloadPolicy to view_only and lowercases the type", () => {
    expect(UploadCreateSchema.parse({ ...valid, mimeType: "Application/PDF" })).toMatchObject({
      mimeType: PDF,
      downloadPolicy: "view_only",
    });
  });

  it("rejects empty or control-character names, zero or fractional sizes, unknown purposes", () => {
    for (const bad of [
      { fileName: "  " },
      { fileName: "a\nb.pdf" },
      { size: 0 },
      { size: 1.5 },
      { purpose: "private" },
    ]) {
      expect(UploadCreateSchema.safeParse({ ...valid, ...bad }).success).toBe(false);
    }
  });
});
