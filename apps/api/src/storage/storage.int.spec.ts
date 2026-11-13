// Step 7.1: a real round trip to R2. Skips itself when the R2 keys are not in .env (CI, fresh
// clones); `npm run r2:check` covers the same plus CORS from the command line.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { R2_ENV_NAMES } from "./r2-config.js";
import { StorageService } from "./storage.service.js";

const hasKeys = R2_ENV_NAMES.every((name) => process.env[name]);

// One retry: under full-suite load a connect to R2 can time out once (seen 2026-11-13).
describe.skipIf(!hasKeys)("StorageService against R2", { retry: 1 }, () => {
  const storage = new StorageService();

  it("a presigned PUT uploads, HEAD sees it, delete removes it", async () => {
    const key = `r2-check/${randomUUID()}.txt`;
    const body = "itqan storage test";
    try {
      const { url } = await storage.presignPut("private", key, { contentType: "text/plain" });
      const put = await fetch(url, {
        method: "PUT",
        body,
        headers: { "Content-Type": "text/plain" },
      });
      expect(put.status).toBe(200);
      expect(await storage.head("private", key)).toMatchObject({ size: body.length });
    } finally {
      await storage.delete("private", key);
    }
    expect(await storage.head("private", key)).toBeNull();
  });

  it("a different size than the signed Content-Length is refused", async () => {
    const key = `r2-check/${randomUUID()}.txt`;
    const { url } = await storage.presignPut("private", key, {
      contentType: "text/plain",
      contentLength: 5,
    });
    const put = await fetch(url, {
      method: "PUT",
      body: "more than five bytes",
      headers: { "Content-Type": "text/plain" },
    });
    expect(put.status).toBe(403);
    expect(await storage.head("private", key)).toBeNull();
  });

  it("a different Content-Type than the signed one is refused", async () => {
    const key = `r2-check/${randomUUID()}.txt`;
    const { url } = await storage.presignPut("private", key, { contentType: "application/pdf" });
    const put = await fetch(url, {
      method: "PUT",
      body: "<script>",
      headers: { "Content-Type": "text/html" },
    });
    expect(put.status).toBe(403);
    expect(await storage.head("private", key)).toBeNull();
  });
});
