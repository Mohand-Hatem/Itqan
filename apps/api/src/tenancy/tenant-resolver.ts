import { Inject, Injectable } from "@nestjs/common";
import { createTenantLookup, PrismaClient, type ResolvedTenant } from "@itqan/database";

export type { ResolvedTenant };

@Injectable()
export class TenantResolver {
  private readonly lookup: ReturnType<typeof createTenantLookup>;

  constructor(@Inject(PrismaClient) db: PrismaClient) {
    this.lookup = createTenantLookup(db);
  }

  findBySlug(slug: string): Promise<ResolvedTenant | null> {
    return this.lookup.findBySlug(slug);
  }

  set(slug: string, tenant: ResolvedTenant): void {
    this.lookup.set(slug, tenant);
  }

  invalidate(slug: string): void {
    this.lookup.invalidate(slug);
  }
}
