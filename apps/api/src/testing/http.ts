import "reflect-metadata";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { z } from "zod";
import { configureApp } from "../app.setup.js";
import { nestOperations } from "../openapi/document.js";
import { operations } from "../openapi/operations.js";

// setCookie is present only when the response sets cookies, so plain toEqual checks keep working.
export type HttpResponse = { status: number; body: unknown; setCookie?: string[] };

type Contract = { method: string; pattern: RegExp; params: number; id: string; schema: z.ZodType };

/**
 * 10R.8: every documented response schema, matched by method and path. Each 2xx JSON answer in an
 * integration test is checked against it, so every HTTP test is also a contract test.
 */
function responseContracts(app: INestApplication): Contract[] {
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  return nestOperations(doc)
    .flatMap(([nestId, path, method]) => {
      const schema = operations[nestId]?.response;
      if (!schema) return [];
      const source = path.replace(/\{[^}]+\}/g, "[^/]+");
      return [{ method: method.toUpperCase(), pattern: new RegExp(`^${source}$`), params: path.split("{").length - 1, id: nestId, schema }];
    })
    .sort((a, b) => a.params - b.params); // literal segments win over parameters
}

function checkContract(contracts: Contract[], method: string, path: string, status: number, body: unknown) {
  if (status < 200 || status > 299 || body === null || typeof body !== "object") return;
  const route = path.split("?")[0]!;
  const contract = contracts.find((c) => c.method === method.toUpperCase() && c.pattern.test(route));
  if (!contract) return;
  const parsed = contract.schema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Response of ${method} ${route} (${contract.id}) breaks its documented schema: ` +
        JSON.stringify(parsed.error.issues.slice(0, 5)),
    );
  }
}

// Boots the real app setup (same as main.ts) on a random port for HTTP tests.
export async function createHttpTestApp(module: Type<unknown>) {
  const app: INestApplication = configureApp(await NestFactory.create(module, { logger: false }));
  await app.listen(0, "127.0.0.1");
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const contracts = responseContracts(app);

  // Sends a request as if it arrived at `host` (the tenant comes from the Host header).
  function send(
    host: string,
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          port,
          path,
          method,
          headers: {
            host,
            ...(payload ? { "content-type": "application/json" } : {}),
            ...extraHeaders,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const status = res.statusCode ?? 0;
              const parsed: unknown = data ? JSON.parse(data) : null;
              checkContract(contracts, method, path, status, parsed);
              resolve({
                status,
                body: parsed,
                ...(res.headers["set-cookie"] ? { setCookie: res.headers["set-cookie"] } : {}),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }

  return {
    app,
    send,
    /** Request through a tenant's own subdomain. */
    requestAs: (tenant: { slug: string }, method: string, path: string, body?: unknown) =>
      send(`${tenant.slug}.localhost`, method, path, body),
    close: () => app.close(),
  };
}
