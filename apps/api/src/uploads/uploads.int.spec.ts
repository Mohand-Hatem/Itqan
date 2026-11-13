// Step 7.2: POST /uploads and /uploads/:id/confirm (FR-C03, docs/06-flows.md §4).
// Tests that touch R2 skip themselves when the R2 keys are not in .env.
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { R2_ENV_NAMES } from "../storage/r2-config.js";
import { StorageService } from "../storage/storage.service.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const hasR2 = R2_ENV_NAMES.every((name) => process.env[name]);
// Without real keys, POST /uploads still signs URLs (signing is local); only the R2 tests skip.
if (!hasR2) {
  Object.assign(process.env, {
    R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    R2_ACCESS_KEY_ID: "test-access-key-id",
    R2_SECRET_ACCESS_KEY: "test-secret-access-key-not-real",
    R2_PRIVATE_BUCKET: "itqan-test-private",
    R2_PUBLIC_BUCKET: "itqan-test-public",
    R2_PUBLIC_URL: "https://pub-test.r2.dev",
  });
}
const fx = studentFixtures("UploadTestPassword123!");
const storage = new StorageService();
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

type Tenant = { id: string; slug: string };
type Created = { asset: { id: string; status: string }; uploadUrl: string; expiresAt: string };
const as = (t: Tenant, cookie: string, method: string, path: string, body?: unknown) =>
  http.send(`${t.slug}.localhost`, method, `/api${path}`, body, { cookie });
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const BODY = "%PDF-1.4 itqan upload test";
const pdf = (over: Record<string, unknown> = {}) => ({
  fileName: "lesson 1.pdf",
  mimeType: "application/pdf",
  size: BODY.length,
  purpose: "content",
  ...over,
});
const putFile = (url: string, body: string, type = "application/pdf") =>
  fetch(url, { method: "PUT", body, headers: { "Content-Type": type } });

describe("POST /api/uploads", () => {
  it("teacher and assistant get a pending asset and a 15-minute upload URL for tenants/{tenantId}/{assetId}", async () => {
    const t = await fx.tenant();
    for (const role of ["teacher", "assistant"] as const) {
      const staff = await fx.staffLogin(t, role);
      const res = await as(t, staff.cookie, "POST", "/uploads", pdf());
      expect(res.status).toBe(201);
      const body = res.body as Created;
      expect(body.asset).toMatchObject({
        status: "pending",
        purpose: "content",
        originalName: "lesson 1.pdf",
        mimeType: "application/pdf",
        fileSize: BODY.length,
        downloadPolicy: "view_only",
      });
      const row = await systemPrisma.mediaAsset.findUniqueOrThrow({ where: { id: body.asset.id } });
      expect(row).toMatchObject({
        tenantId: t.id,
        uploadedBy: staff.user.id,
        storageKey: `tenants/${t.id}/${body.asset.id}`,
      });
      if (hasR2) {
        const url = new URL(body.uploadUrl);
        expect(url.pathname).toBe(`/tenants/${t.id}/${body.asset.id}`);
        expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
      }
    }
  });

  it("students get 403 ROLE_FORBIDDEN", async () => {
    const t = await fx.tenant();
    const { user } = await fx.member(t.id, "student");
    const student = await fx.studentLogin(t, user.email);
    const res = await as(t, student.cookies, "POST", "/uploads", pdf());
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
  });

  it("refuses disallowed types, oversize files and bad bodies, and creates no asset", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");
    const cases: [Record<string, unknown>, string][] = [
      [{ mimeType: "image/svg+xml", fileName: "x.svg" }, "UPLOAD_TYPE_NOT_ALLOWED"],
      [{ mimeType: "text/html", fileName: "x.html" }, "UPLOAD_TYPE_NOT_ALLOWED"],
      [{ purpose: "public" }, "UPLOAD_TYPE_NOT_ALLOWED"], // PDFs never go to the public bucket
      [{ size: 100 * 1024 * 1024 + 1 }, "UPLOAD_TOO_LARGE"],
      [{ mimeType: "image/png", size: 10 * 1024 * 1024 + 1 }, "UPLOAD_TOO_LARGE"],
      [{ size: -1 }, "INVALID_BODY"],
      [{ fileName: "" }, "INVALID_BODY"],
    ];
    for (const [over, reason] of cases) {
      const res = await as(t, teacher.cookie, "POST", "/uploads", pdf(over));
      expect(res.status, reason).toBe(400);
      expect(reasonOf(res.body)).toBe(reason);
    }
    expect(await systemPrisma.mediaAsset.count({ where: { tenantId: t.id } })).toBe(0);
  });

  it("ignores a tenant or uploader sent in the body", async () => {
    const [t, other] = [await fx.tenant(), await fx.tenant()];
    const teacher = await fx.staffLogin(t, "teacher");
    const res = await as(
      t,
      teacher.cookie,
      "POST",
      "/uploads",
      pdf({ tenantId: other.id, uploadedBy: other.id }),
    );
    expect(res.status).toBe(201);
    const row = await systemPrisma.mediaAsset.findUniqueOrThrow({
      where: { id: (res.body as Created).asset.id },
    });
    expect(row).toMatchObject({ tenantId: t.id, uploadedBy: teacher.user.id });
  });
});

describe("POST /api/uploads/:id/confirm", () => {
  it("another tenant's staff get 404 ASSET_NOT_FOUND, and the asset is unchanged", async () => {
    const [a, b] = [await fx.tenant(), await fx.tenant()];
    const teacherA = await fx.staffLogin(a, "teacher");
    const teacherB = await fx.staffLogin(b, "teacher");
    const created = (await as(a, teacherA.cookie, "POST", "/uploads", pdf())).body as Created;

    const res = await as(b, teacherB.cookie, "POST", `/uploads/${created.asset.id}/confirm`);
    expect(res.status).toBe(404);
    expect(reasonOf(res.body)).toBe("ASSET_NOT_FOUND");
    expect(
      await systemPrisma.mediaAsset.findUniqueOrThrow({ where: { id: created.asset.id } }),
    ).toMatchObject({ tenantId: a.id, status: "pending" });
  });

  it("students get 403 ROLE_FORBIDDEN", async () => {
    const t = await fx.tenant();
    const teacher = await fx.staffLogin(t, "teacher");
    const created = (await as(t, teacher.cookie, "POST", "/uploads", pdf())).body as Created;
    const { user } = await fx.member(t.id, "student");
    const student = await fx.studentLogin(t, user.email);
    const res = await as(t, student.cookies, "POST", `/uploads/${created.asset.id}/confirm`);
    expect(res.status).toBe(403);
  });

  describe.skipIf(!hasR2)("against R2", { retry: 1 }, () => {
    it("before the upload: 409 UPLOAD_NOT_FOUND and the asset stays pending", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const created = (await as(t, teacher.cookie, "POST", "/uploads", pdf())).body as Created;
      const res = await as(t, teacher.cookie, "POST", `/uploads/${created.asset.id}/confirm`);
      expect(res.status).toBe(409);
      expect(reasonOf(res.body)).toBe("UPLOAD_NOT_FOUND");
      expect(
        await systemPrisma.mediaAsset.findUniqueOrThrow({ where: { id: created.asset.id } }),
      ).toMatchObject({ status: "pending" });
    });

    it("upload then confirm makes it ready with one audit entry; confirming again changes nothing", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const created = (await as(t, teacher.cookie, "POST", "/uploads", pdf())).body as Created;
      const key = `tenants/${t.id}/${created.asset.id}`;
      try {
        expect((await putFile(created.uploadUrl, BODY)).status).toBe(200);

        for (let i = 0; i < 2; i++) {
          const res = await as(t, teacher.cookie, "POST", `/uploads/${created.asset.id}/confirm`);
          expect(res.status).toBe(200);
          expect(res.body).toMatchObject({ id: created.asset.id, status: "ready" });
        }
        const audits = await systemPrisma.auditLog.findMany({
          where: { tenantId: t.id, targetId: created.asset.id },
        });
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          action: "media.upload",
          targetType: "media_asset",
          actorUserId: teacher.user.id,
        });
      } finally {
        await storage.delete("private", key);
      }
    });

    it("R2 refuses a bigger file than declared at the upload itself", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const created = (await as(t, teacher.cookie, "POST", "/uploads", pdf())).body as Created;
      expect((await putFile(created.uploadUrl, `${BODY} and more`)).status).toBe(403);
    });

    it("a stored file that differs from the declaration: 409 UPLOAD_MISMATCH, asset failed, file deleted", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const created = (await as(t, teacher.cookie, "POST", "/uploads", pdf())).body as Created;
      const key = `tenants/${t.id}/${created.asset.id}`;
      // Put a different file under the asset's key, as if the signed checks had been bypassed.
      const { url } = await storage.presignPut("private", key, { contentType: "text/plain" });
      expect((await putFile(url, "short", "text/plain")).status).toBe(200);

      const res = await as(t, teacher.cookie, "POST", `/uploads/${created.asset.id}/confirm`);
      expect(res.status).toBe(409);
      expect(reasonOf(res.body)).toBe("UPLOAD_MISMATCH");
      expect(
        await systemPrisma.mediaAsset.findUniqueOrThrow({ where: { id: created.asset.id } }),
      ).toMatchObject({ status: "failed" });
      expect(await storage.head("private", key)).toBeNull();
    });

    it("a public image goes to the public bucket", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const png = "PNG fake image bytes"; // ASCII, so string length = byte length
      const created = (
        await as(
          t,
          teacher.cookie,
          "POST",
          "/uploads",
          pdf({ fileName: "logo.png", mimeType: "image/png", size: png.length, purpose: "public" }),
        )
      ).body as Created;
      const key = `tenants/${t.id}/${created.asset.id}`;
      try {
        expect((await putFile(created.uploadUrl, png, "image/png")).status).toBe(200);
        const res = await as(t, teacher.cookie, "POST", `/uploads/${created.asset.id}/confirm`);
        expect(res.body).toMatchObject({ status: "ready", purpose: "public" });
        expect(await storage.head("public", key)).not.toBeNull();
      } finally {
        await storage.delete("public", key);
      }
    });
  });
});
