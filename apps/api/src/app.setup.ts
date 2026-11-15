import type { INestApplication } from "@nestjs/common";
import type { Application } from "express";
import helmet from "helmet";

// Shared by main.ts and the HTTP tests so both run the same app setup.
export function configureApp(app: INestApplication): INestApplication {
  // Trust X-Forwarded-For only from private-network proxies (our Nginx container),
  // so req.ip is the real visitor and a visitor cannot fake it.
  (app.getHttpAdapter().getInstance() as Application).set(
    "trust proxy",
    "loopback, linklocal, uniquelocal",
  );

  // Security headers on every response, errors included (docs/09 §2, step 10.2a). The API
  // only returns JSON and event streams, so its CSP allows nothing and no framing.
  // HSTS is set once, at the HTTPS edge (Nginx), not here on plain HTTP.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      strictTransportSecurity: false,
    }),
  );

  // No CORS: pages and /api share one host (Nginx; Next.js rewrites in the preview), so no
  // other origin may read API responses. Browser uploads go to R2, which has its own CORS.
  app.setGlobalPrefix("api");
  return app;
}
