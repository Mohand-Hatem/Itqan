// `npm run openapi:export` (step 10.6): writes docs/api/openapi.json for Apidog and Postman.
// Runs from the tsc build (dist/), because Nest needs the decorator metadata tsc emits.
import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";

const ROOT = resolve(__dirname, "../../../..");
config({ path: resolve(ROOT, ".env"), quiet: true });
process.env["JOBS_ENABLED"] = "false"; // no timers while describing the routes

async function main() {
  const { NestFactory } = await import("@nestjs/core");
  const { auth } = await import("@itqan/auth");
  const { AppModule } = await import("../app.module.js");
  const { configureApp } = await import("../app.setup.js");
  const { buildOpenApiDocument, writeRoutes } = await import("./document.js");
  const app = configureApp(await NestFactory.create(AppModule, { logger: ["error"] }));
  // Present only outside production (packages/auth/src/auth.ts).
  const api = auth.api as unknown as { generateOpenAPISchema?: () => Promise<unknown> };
  if (!api.generateOpenAPISchema) throw new Error("Run the export outside production (NODE_ENV).");
  const authSpec = await api.generateOpenAPISchema();
  const doc = buildOpenApiDocument(app, authSpec as never);
  const out = resolve(ROOT, "docs/api/openapi.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  console.log(`wrote ${out}: ${Object.keys(doc.paths).length} paths`);
  if (process.argv.includes("--list-writes")) console.log(writeRoutes(doc).join("\n"));
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
