import type { PrismaClient } from "./generated/prisma/client.js";

export type ResolvedTenant = { id: string; slug: string };

const TTL_MS = 60_000;
/** Cap on cached slugs, so random subdomains cannot grow memory without limit (step 10.3). */
export const TENANT_CACHE_MAX = 10_000;

export function getRootDomain(): string {
  const root = process.env["PLATFORM_ROOT_DOMAIN"];
  if (root) return root;
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("PLATFORM_ROOT_DOMAIN must be set in production.");
  }
  return "localhost";
}

/** Active tenant by slug, cached 60 s (FR-T01). Shared by the API middleware and the auth endpoints. */
export function createTenantLookup(db: Pick<PrismaClient, "tenant">) {
  // Misses are cached too, so random subdomains cannot hammer the database.
  const cache = new Map<string, { tenant: ResolvedTenant | null; expiresAt: number }>();

  return {
    async findBySlug(slug: string): Promise<ResolvedTenant | null> {
      const hit = cache.get(slug);
      if (hit && hit.expiresAt > Date.now()) return hit.tenant;

      const tenant = await db.tenant.findFirst({
        where: { slug, status: "active", deletedAt: null },
        select: { id: true, slug: true },
      });
      if (cache.size >= TENANT_CACHE_MAX) {
        for (const [key, entry] of cache) if (entry.expiresAt <= Date.now()) cache.delete(key);
        if (cache.size >= TENANT_CACHE_MAX) cache.clear();
      }
      cache.set(slug, { tenant, expiresAt: Date.now() + TTL_MS });
      return tenant;
    },
    set(slug: string, tenant: ResolvedTenant): void {
      cache.set(slug, { tenant, expiresAt: Date.now() + TTL_MS });
    },
    invalidate(slug: string): void {
      cache.delete(slug);
    },
    get size(): number {
      return cache.size;
    },
  };
}
