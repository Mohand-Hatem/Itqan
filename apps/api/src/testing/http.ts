import "reflect-metadata";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication, Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { configureApp } from "../app.setup.js";

// setCookie is present only when the response sets cookies, so plain toEqual checks keep working.
export type HttpResponse = { status: number; body: unknown; setCookie?: string[] };

// Boots the real app setup (same as main.ts) on a random port for HTTP tests.
export async function createHttpTestApp(module: Type<unknown>) {
  const app: INestApplication = configureApp(await NestFactory.create(module, { logger: false }));
  await app.listen(0, "127.0.0.1");
  const port = (app.getHttpServer().address() as AddressInfo).port;

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
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: data ? JSON.parse(data) : null,
              ...(res.headers["set-cookie"] ? { setCookie: res.headers["set-cookie"] } : {}),
            }),
          );
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
