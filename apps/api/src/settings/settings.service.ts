import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { getRequestContext, type ScopedPrismaClient } from "@itqan/database";
import {
  ContentReasonCode,
  type PublicSettingsResponse,
  readTenantSettings,
  type TenantSettings,
  type TenantSettingsPatch,
  type TenantSettingsResponse,
} from "@itqan/shared";
import { AuditService } from "../audit/audit.service.js";
import { SCOPED_PRISMA } from "../database/database.module.js";
import { StorageService } from "../storage/storage.service.js";
import { cleanPageHtml } from "./page-html.js";

type Db = Pick<ScopedPrismaClient, "tenant" | "mediaAsset">;

const assetIdsOf = (s: TenantSettings) =>
  [s.branding.logoAssetId, s.branding.faviconAssetId, s.hero.imageAssetId].filter(
    (id): id is string => id !== null,
  );

/** Tenant website settings (step 7.11, FR-T06). The tenant always comes from the host. */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(SCOPED_PRISMA) private readonly db: ScopedPrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async get(): Promise<TenantSettingsResponse> {
    const { name, settings } = await this.load(this.db);
    return this.full(name, settings);
  }

  async getPublic(): Promise<PublicSettingsResponse> {
    const { name, settings: s } = await this.load(this.db);
    const urls = await this.urls(s);
    return {
      name,
      branding: {
        logoUrl: urls.logo,
        faviconUrl: urls.favicon,
        primaryColor: s.branding.primaryColor,
        secondaryColor: s.branding.secondaryColor,
      },
      hero: { title: s.hero.title, subtitle: s.hero.subtitle, imageUrl: urls.heroImage },
      pages: s.pages,
      contact: s.contact,
      social: s.social,
      locale: s.locale,
      timezone: s.timezone,
    };
  }

  async update(patch: TenantSettingsPatch, actorUserId: string): Promise<TenantSettingsResponse> {
    const tenantId = this.tenantId();
    const { name: newName, ...parts } = patch;
    if (parts.pages) {
      parts.pages = {
        aboutHtml: cleanPageHtml(parts.pages.aboutHtml),
        howItWorksHtml: cleanPageHtml(parts.pages.howItWorksHtml),
      };
    }

    const result = await this.db.$transaction(async (tx) => {
      // One settings save at a time per tenant, so two parts saved together both stick.
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const current = await this.load(tx);
      const next: TenantSettings = { ...current.settings, ...parts };
      await this.checkAssets(tx, next, current.settings);

      const row = await tx.tenant.update({
        where: { id: tenantId },
        data: { settings: next, ...(newName !== undefined ? { name: newName } : {}) },
        select: { name: true },
      });
      await this.audit.record(
        {
          action: "tenant.settings_update",
          targetType: "tenant",
          targetId: tenantId,
          actorUserId,
          meta: { changed: Object.keys(patch).sort() },
        },
        tx,
      );
      return { name: row.name, settings: next };
    });
    return this.full(result.name, result.settings);
  }

  private tenantId() {
    const ctx = getRequestContext();
    if (ctx?.kind !== "tenant") {
      throw new BadRequestException({
        statusCode: 400,
        reason: "TENANT_REQUIRED",
        message: "No tenant context found in request",
      });
    }
    return ctx.tenantId;
  }

  private async load(db: Db) {
    const row = await db.tenant.findUniqueOrThrow({
      where: { id: this.tenantId() },
      select: { name: true, settings: true },
    });
    return { name: row.name, settings: readTenantSettings(row.settings) };
  }

  private async full(name: string, settings: TenantSettings): Promise<TenantSettingsResponse> {
    return { name, ...settings, urls: await this.urls(settings) };
  }

  /** Newly chosen images must be this tenant's ready public images (the bucket holds only images). */
  private async checkAssets(db: Db, next: TenantSettings, current: TenantSettings) {
    const kept = new Set(assetIdsOf(current));
    const added = assetIdsOf(next).filter((id) => !kept.has(id));
    if (added.length === 0) return;
    const found = await db.mediaAsset.count({
      where: { id: { in: added }, status: "ready", purpose: "public" },
    });
    if (found !== new Set(added).size) {
      throw new BadRequestException({
        statusCode: 400,
        reason: ContentReasonCode.ASSET_NOT_USABLE,
        message: "Use an uploaded public image of this site.",
      });
    }
  }

  private async urls(s: TenantSettings) {
    const ids = assetIdsOf(s);
    const assets = ids.length
      ? await this.db.mediaAsset.findMany({
          where: { id: { in: ids }, status: "ready", purpose: "public" },
          select: { id: true, storageKey: true },
        })
      : [];
    const keyOf = new Map(assets.map((a) => [a.id, a.storageKey]));
    const url = (id: string | null) => {
      const key = id ? keyOf.get(id) : undefined;
      return key ? this.storage.publicUrl(key) : null;
    };
    return {
      logo: url(s.branding.logoAssetId),
      favicon: url(s.branding.faviconAssetId),
      heroImage: url(s.hero.imageAssetId),
    };
  }
}
