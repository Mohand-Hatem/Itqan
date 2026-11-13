// Step 7.1: R2 config and presigned URLs. Signing is local (no network), so these run without keys.
import { describe, expect, it } from "vitest";
import { R2_ENV_NAMES, loadR2Config } from "./r2-config.js";
import {
  PRESIGN_GET_DOC_SECONDS,
  PRESIGN_GET_VIDEO_SECONDS,
  PRESIGN_PUT_SECONDS,
  StorageService,
  contentDisposition,
  tenantKey,
} from "./storage.service.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const env = {
  R2_ACCOUNT_ID: ACCOUNT,
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key-not-real",
  R2_PRIVATE_BUCKET: "itqan-test-private",
  R2_PUBLIC_BUCKET: "itqan-test-public",
  R2_PUBLIC_URL: "https://pub-test.r2.dev",
};
const TENANT = "019a0000-0000-7000-8000-000000000001";
const ASSET = "019a0000-0000-7000-8000-000000000002";

describe("loadR2Config", () => {
  it("reads all six values", () => {
    expect(loadR2Config(env)).toEqual({
      accountId: ACCOUNT,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      buckets: { private: "itqan-test-private", public: "itqan-test-public" },
      publicUrl: "https://pub-test.r2.dev",
    });
  });

  it("names every missing variable and never prints a value", () => {
    const partial = { ...env, R2_ACCESS_KEY_ID: "", R2_PUBLIC_URL: undefined };
    expect(() => loadR2Config(partial)).toThrow(/R2_ACCESS_KEY_ID, R2_PUBLIC_URL/);
    try {
      loadR2Config({ ...env, R2_ACCOUNT_ID: "" });
    } catch (e) {
      expect(String(e)).not.toContain(env.R2_SECRET_ACCESS_KEY);
    }
    expect(R2_ENV_NAMES).toHaveLength(6);
  });

  it("rejects a malformed account id or public URL", () => {
    expect(() => loadR2Config({ ...env, R2_ACCOUNT_ID: "not-an-id" })).toThrow(/R2_ACCOUNT_ID/);
    expect(() => loadR2Config({ ...env, R2_PUBLIC_URL: "http://pub-test.r2.dev" })).toThrow(
      /R2_PUBLIC_URL/,
    );
    expect(() => loadR2Config({ ...env, R2_PUBLIC_URL: "https://pub-test.r2.dev/" })).toThrow(
      /R2_PUBLIC_URL/,
    );
  });
});

describe("tenantKey", () => {
  it("builds tenants/{tenantId}/{assetId} (docs/03 §4)", () => {
    expect(tenantKey(TENANT, ASSET)).toBe(`tenants/${TENANT}/${ASSET}`);
  });

  it("refuses anything that is not a uuid, so a key cannot escape its tenant prefix", () => {
    expect(() => tenantKey("../other", ASSET)).toThrow();
    expect(() => tenantKey(TENANT, "a/../../b")).toThrow();
  });
});

describe("StorageService.presignPut", () => {
  const storage = new StorageService(() => loadR2Config(env));

  it("signs one PUT of one key in one bucket, for 15 minutes, with the content type", async () => {
    const before = Date.now();
    const { url, expiresAt } = await storage.presignPut("private", tenantKey(TENANT, ASSET), {
      contentType: "application/pdf",
    });
    const u = new URL(url);

    expect(u.protocol).toBe("https:");
    expect(u.host).toBe(`itqan-test-private.${ACCOUNT}.r2.cloudflarestorage.com`);
    expect(u.pathname).toBe(`/tenants/${TENANT}/${ASSET}`);
    expect(u.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_PUT_SECONDS));
    expect(PRESIGN_PUT_SECONDS).toBe(900);
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    // SDK checksum defaults are off: R2 would reject a checksum the browser cannot send.
    expect([...u.searchParams.keys()].some((k) => k.toLowerCase().includes("checksum"))).toBe(
      false,
    );
    expect(url).not.toContain(env.R2_SECRET_ACCESS_KEY);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 900_000 - 1000);
  });

  it("signs Content-Length when a size is given", async () => {
    const { url } = await storage.presignPut("private", tenantKey(TENANT, ASSET), {
      contentType: "video/mp4",
      contentLength: 1234,
    });
    expect(new URL(url).searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
  });

  it("signs a GET that forces the content type and disposition", async () => {
    const { url, expiresAt } = await storage.presignGet("private", tenantKey(TENANT, ASSET), {
      expiresIn: PRESIGN_GET_DOC_SECONDS,
      contentType: "application/pdf",
      disposition: contentDisposition("inline", "notes.pdf"),
    });
    const u = new URL(url);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(u.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(u.searchParams.get("response-content-disposition")).toContain("inline");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 299_000);
    expect(PRESIGN_GET_VIDEO_SECONDS).toBe(4 * 3600);
  });

  it("uses the public bucket only when asked", async () => {
    const { url } = await storage.presignPut("public", `tenants/${TENANT}/logo`, {
      contentType: "image/png",
    });
    expect(new URL(url).host).toBe(`itqan-test-public.${ACCOUNT}.r2.cloudflarestorage.com`);
  });

  it("builds public URLs from R2_PUBLIC_URL", () => {
    expect(storage.publicUrl(`tenants/${TENANT}/logo`)).toBe(
      `https://pub-test.r2.dev/tenants/${TENANT}/logo`,
    );
  });

  it("does not need the keys until it is used", () => {
    expect(() => new StorageService(() => loadR2Config({}))).not.toThrow();
  });
});

describe("contentDisposition", () => {
  it("keeps ASCII names and encodes Arabic names in filename*", () => {
    expect(contentDisposition("attachment", "notes.pdf")).toBe(
      `attachment; filename="notes.pdf"; filename*=UTF-8''notes.pdf`,
    );
    const arabic = contentDisposition("attachment", "درس 1.pdf");
    expect(arabic).toContain(`filename*=UTF-8''${encodeURIComponent("درس 1.pdf")}`);
    expect(arabic).toMatch(/^attachment; filename="[ -~]+";/);
  });

  it("cannot be broken out of by quotes or backslashes in the name", () => {
    expect(contentDisposition("inline", 'a"b\\c.pdf')).toMatch(/^inline; filename="a_b_c\.pdf";/);
  });
});
