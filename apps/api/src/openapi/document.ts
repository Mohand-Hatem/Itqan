import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { z } from "zod";
import { requestBodies } from "./bodies.js";

type Operation = NonNullable<OpenAPIObject["paths"][string]["post"]>;
const WRITE = ["post", "put", "patch"] as const;

/** Zod schema → OpenAPI 3.0 schema object (request shape, so input side of transforms). */
function toOpenApiSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, {
    io: "input",
    unrepresentable: "any",
    target: "openapi-3.0",
  });
  delete (json as Record<string, unknown>)["$schema"];
  return json;
}

/**
 * The full API description (step 10.6): NestJS routes from the controllers, request bodies from
 * the Zod schemas the controllers validate with (bodies.ts), and Better Auth's /api/auth/* routes.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  authSpec?: OpenAPIObject,
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Itqan API")
    .setDescription(
      "Multi-tenant LMS API. The tenant comes from the Host header (`<slug>.localhost` locally); " +
        "sign in first through `/api/auth/sign-in/email` (staff) or `/api/auth/sign-in/student`, " +
        "then the session and device cookies carry over. See README for Apidog and Postman.",
    )
    .setVersion("0.1.0")
    .addServer("http://demo.localhost:8080", "Local Docker stack through Nginx (tenant demo)")
    .addCookieAuth("better-auth.session_token")
    .build();
  const doc = SwaggerModule.createDocument(app, config);

  for (const [key, schema] of Object.entries(requestBodies)) {
    const [method, path] = key.split(" ") as [string, string];
    const op = doc.paths[path]?.[method.toLowerCase() as (typeof WRITE)[number]] as
      Operation | undefined;
    if (!op) throw new Error(`openapi/bodies.ts names a route that does not exist: ${key}`);
    if (schema) {
      op.requestBody = {
        required: true,
        content: { "application/json": { schema: toOpenApiSchema(schema) as never } },
      };
    }
  }

  if (authSpec) {
    for (const [path, item] of Object.entries(authSpec.paths ?? {})) {
      const full = `/api/auth${path}`;
      for (const op of Object.values(item) as Operation[]) {
        if (op && typeof op === "object" && "responses" in op) op.tags = ["auth (Better Auth)"];
      }
      doc.paths[full] = item;
    }
    doc.components = {
      ...doc.components,
      schemas: { ...(authSpec.components?.schemas ?? {}), ...(doc.components?.schemas ?? {}) },
    };
  }
  return doc;
}

/** Write routes (POST, PUT, PATCH) of the NestJS API, as "METHOD /path" keys. */
export function writeRoutes(doc: OpenAPIObject): string[] {
  return Object.entries(doc.paths)
    .filter(([path]) => !path.startsWith("/api/auth/"))
    .flatMap(([path, item]) =>
      WRITE.filter((m) => item[m]).map((m) => `${m.toUpperCase()} ${path}`),
    )
    .sort();
}
