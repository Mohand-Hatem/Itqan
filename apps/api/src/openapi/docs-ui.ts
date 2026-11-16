import type { INestApplication } from "@nestjs/common";
import { SwaggerModule } from "@nestjs/swagger";
import { auth } from "@itqan/auth";
import type { NextFunction, Request, Response } from "express";
import { buildOpenApiDocument } from "./document.js";

/** Swagger UI at /api/docs (step 10.6). Called from main.ts outside production only. */
export async function setupApiDocs(app: INestApplication): Promise<void> {
  const api = auth.api as unknown as { generateOpenAPISchema?: () => Promise<unknown> };
  const doc = buildOpenApiDocument(app, (await api.generateOpenAPISchema?.()) as never);
  // The API's helmet CSP allows nothing; this developer page needs its own scripts and styles.
  app.use("/api/docs", (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
    );
    next();
  });
  SwaggerModule.setup("api/docs", app, doc);
}
