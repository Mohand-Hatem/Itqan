// Step 10.6: the OpenAPI file stays in step with the code.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { auth } from "@itqan/auth";
import type { OpenAPIObject } from "@nestjs/swagger";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { requestBodies } from "./bodies.js";
import { buildOpenApiDocument, writeRoutes } from "./document.js";

let http: Awaited<ReturnType<typeof createHttpTestApp>>;
let doc: OpenAPIObject;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
  const api = auth.api as unknown as { generateOpenAPISchema: () => Promise<unknown> };
  doc = buildOpenApiDocument(http.app, (await api.generateOpenAPISchema()) as never);
});

afterAll(async () => {
  await http?.close();
});

const ops = (d: OpenAPIObject) =>
  Object.entries(d.paths)
    .flatMap(([path, item]) =>
      ["get", "post", "put", "patch", "delete"]
        .filter((m) => (item as Record<string, unknown>)[m])
        .map((m) => `${m} ${path}`),
    )
    .sort();

describe("OpenAPI document (step 10.6)", () => {
  it("maps every write route to a request body (or to null for routes without one)", () => {
    expect(Object.keys(requestBodies).sort()).toEqual(writeRoutes(doc));
  });

  it("shows a request body on every write route that has a schema", () => {
    for (const [key, schema] of Object.entries(requestBodies)) {
      const [method, path] = key.split(" ") as [string, string];
      const op = (doc.paths[path] as Record<string, { requestBody?: unknown }>)[
        method.toLowerCase()
      ];
      expect(Boolean(op?.requestBody), key).toBe(schema !== null);
    }
  });

  it("includes the Better Auth sign-in routes", () => {
    expect(doc.paths["/api/auth/sign-in/email"]).toBeDefined();
    expect(doc.paths["/api/auth/sign-in/student"]).toBeDefined();
  });

  it("docs/api/openapi.json is up to date (run `npm run openapi:export` if this fails)", () => {
    const file = JSON.parse(
      readFileSync(resolve(__dirname, "../../../../docs/api/openapi.json"), "utf8"),
    ) as OpenAPIObject;
    expect(ops(file)).toEqual(ops(doc));
    for (const [key, schema] of Object.entries(requestBodies)) {
      if (!schema) continue;
      const [method, path] = key.split(" ") as [string, string];
      const body = (p: OpenAPIObject) =>
        (p.paths[path] as Record<string, { requestBody?: unknown }>)[method.toLowerCase()]
          ?.requestBody;
      expect(body(file), key).toEqual(body(doc));
    }
  });
});
