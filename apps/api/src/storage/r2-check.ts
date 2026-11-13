// `npm run r2:check` (step 7.1): proves the R2 keys, both buckets and CORS work, with curl.
// Prints statuses only, never a URL: presigned URLs are short-lived credentials.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { devNull } from "node:os";
import { loadR2Config } from "./r2-config.js";
import { StorageService } from "./storage.service.js";

// Local web origins that upload from the browser (docs/10-dev-setup.md §R2, CORS rule).
const ORIGINS = ["http://localhost:3000", "http://drahmed.localhost:3000"];

process.loadEnvFile(".env");
const storage = new StorageService(() => loadR2Config());
let failed = false;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✔" : "✖"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed = true;
}

const curl = (args: string[]) => execFileSync("curl", ["-s", ...args], { encoding: "utf8" });

async function main() {
  const key = `r2-check/${randomUUID()}.txt`;
  const pubKey = `r2-check/${randomUUID()}.txt`;
  try {
    const { url } = await storage.presignPut("private", key, { contentType: "text/plain" });
    const putStatus = curl(
      ["-o", devNull, "-w", "%{http_code}", "-X", "PUT"].concat([
        "-H",
        "Content-Type: text/plain",
        "--data-binary",
        "itqan r2 check",
        url,
      ]),
    );
    check(
      "presigned PUT to the private bucket with curl",
      putStatus === "200",
      `HTTP ${putStatus}`,
    );

    const head = await storage.head("private", key);
    check("HEAD sees the uploaded object", head?.size === "itqan r2 check".length);

    for (const origin of ORIGINS) {
      const headers = curl(
        ["-o", devNull, "-D", "-", "-X", "OPTIONS", "-H", `Origin: ${origin}`]
          .concat(["-H", "Access-Control-Request-Method: PUT"])
          .concat(["-H", "Access-Control-Request-Headers: content-type", url]),
      );
      const allowed = /^access-control-allow-origin:\s*(\S+)/im.exec(headers)?.[1];
      check(
        `CORS preflight from ${origin}`,
        allowed === origin || allowed === "*",
        allowed ?? "no allow-origin header",
      );
    }

    const pub = await storage.presignPut("public", pubKey, { contentType: "text/plain" });
    const pubPut = curl(
      ["-o", devNull, "-w", "%{http_code}", "-X", "PUT"].concat([
        "-H",
        "Content-Type: text/plain",
        "--data-binary",
        "itqan public check",
        pub.url,
      ]),
    );
    check("presigned PUT to the public bucket", pubPut === "200", `HTTP ${pubPut}`);
    const pubGet = curl(["-o", devNull, "-w", "%{http_code}", storage.publicUrl(pubKey)]);
    check("the object is readable at R2_PUBLIC_URL", pubGet === "200", `HTTP ${pubGet}`);
  } finally {
    await storage.delete("private", key).catch(() => undefined);
    await storage.delete("public", pubKey).catch(() => undefined);
  }
  check("test objects deleted", (await storage.head("private", key)) === null);
}

main()
  .catch((e: unknown) => {
    check("R2 check", false, e instanceof Error ? e.message : "unexpected error");
  })
  .finally(() => {
    console.log(failed ? "\nR2 check failed." : "\nR2 is ready.");
    process.exitCode = failed ? 1 : 0;
  });
