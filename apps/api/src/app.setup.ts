import type { INestApplication } from "@nestjs/common";
import type { Application } from "express";

// Shared by main.ts and the HTTP tests so both run the same app setup.
export function configureApp(app: INestApplication): INestApplication {
  // Trust X-Forwarded-For only from private-network proxies (our Nginx container),
  // so req.ip is the real visitor and a visitor cannot fake it.
  (app.getHttpAdapter().getInstance() as Application).set(
    "trust proxy",
    "loopback, linklocal, uniquelocal",
  );
  app.setGlobalPrefix("api");
  app.enableCors();
  return app;
}
