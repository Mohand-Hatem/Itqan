import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { runWithContext } from "@itqan/database";
import type { NextFunction, Request, Response } from "express";
import { getRootDomain, parseHost } from "./parse-host.js";
import { TenantResolver } from "./tenant-resolver.js";

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly rootDomain = getRootDomain();

  constructor(@Inject(TenantResolver) private readonly resolver: TenantResolver) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // The tenant comes only from the Host header that Nginx forwards, never from the body or query.
    const target = parseHost(req.headers.host, this.rootDomain);
    // req.ip is the real visitor: X-Forwarded-For is only trusted from our proxy (app.setup.ts).
    const origin = { ip: req.ip, userAgent: req.headers["user-agent"] };

    if (target.kind === "admin") return runWithContext({ kind: "admin", ...origin }, next);

    const tenant = target.kind === "tenant" ? await this.resolver.findBySlug(target.slug) : null;
    if (!tenant) {
      res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: "Unknown site." } });
      return;
    }
    runWithContext(
      { kind: "tenant", tenantId: tenant.id, tenantSlug: tenant.slug, ...origin },
      next,
    );
  }
}
