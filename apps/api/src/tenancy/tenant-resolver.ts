import { Inject, Injectable } from "@nestjs/common";
import { PrismaClient } from "@itqan/database";

export type ResolvedTenant = { id: string; slug: string };

const TTL_MS = 60_000;

@Injectable()
export class TenantResolver {
  // Misses are cached too, so random subdomains cannot hammer the database.
  private readonly cache = new Map<string, { tenant: ResolvedTenant | null; expiresAt: number }>();

  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  async findBySlug(slug: string): Promise<ResolvedTenant | null> {
    const hit = this.cache.get(slug);
    if (hit && hit.expiresAt > Date.now()) return hit.tenant;

    const tenant = await this.db.tenant.findFirst({
      where: { slug, status: "active", deletedAt: null },
      select: { id: true, slug: true },
    });
    this.cache.set(slug, { tenant, expiresAt: Date.now() + TTL_MS });
    return tenant;
  }
}
