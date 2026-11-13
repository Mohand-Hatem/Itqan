// Tenant website settings (step 7.11, FR-T06), stored in tenants.settings (jsonb).
// Every field has a default, so a tenant with {} settings reads as a complete object.
import { z } from "zod";

export const DEFAULT_TIMEZONE = "Africa/Cairo";
export const MAX_PAGE_HTML = 20_000;
export const MAX_DEFAULT_DEVICES = 5;

const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const Color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use #RRGGBB")
  .nullable()
  .default(null);
const AssetRef = z.uuid().nullable().default(null);
const Text = (max: number) => z.string().trim().max(max).default("");
const HttpsLink = z
  .url({ protocol: /^https$/ })
  .max(500)
  .nullable()
  .default(null);

export const BrandingSchema = z
  .object({
    logoAssetId: AssetRef,
    faviconAssetId: AssetRef,
    primaryColor: Color,
    secondaryColor: Color,
  })
  .strict();

export const HeroSchema = z
  .object({ title: Text(120), subtitle: Text(300), imageAssetId: AssetRef })
  .strict();

/** HTML is cleaned by the API (sanitize-html) before it is stored. */
export const PagesSchema = z
  .object({
    aboutHtml: z.string().max(MAX_PAGE_HTML).default(""),
    howItWorksHtml: z.string().max(MAX_PAGE_HTML).default(""),
  })
  .strict();

export const ContactSchema = z
  .object({
    email: z.union([z.email().max(200), z.literal("")]).default(""),
    phone: Text(40),
    whatsapp: Text(40),
    address: Text(300),
  })
  .strict();

export const SocialSchema = z
  .object({
    facebook: HttpsLink,
    youtube: HttpsLink,
    instagram: HttpsLink,
    telegram: HttpsLink,
    tiktok: HttpsLink,
    x: HttpsLink,
  })
  .strict();

const sections = {
  branding: BrandingSchema,
  hero: HeroSchema,
  pages: PagesSchema,
  contact: ContactSchema,
  social: SocialSchema,
  locale: z.enum(["ar", "en"]).default("ar"),
  timezone: z.string().refine(isTimezone, "Unknown timezone").default(DEFAULT_TIMEZONE),
  defaultMaxDevices: z.number().int().min(1).max(MAX_DEFAULT_DEVICES).default(1),
};

export const TenantSettingsSchema = z.object({
  branding: sections.branding.prefault({}),
  hero: sections.hero.prefault({}),
  pages: sections.pages.prefault({}),
  contact: sections.contact.prefault({}),
  social: sections.social.prefault({}),
  locale: sections.locale,
  timezone: sections.timezone,
  defaultMaxDevices: sections.defaultMaxDevices,
});
export type TenantSettings = z.infer<typeof TenantSettingsSchema>;

/**
 * Reads stored settings. A part that does not match the schema (old or hand-edited data)
 * falls back to its defaults instead of failing the whole read.
 */
export function readTenantSettings(raw: unknown): TenantSettings {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(TenantSettingsSchema.shape)) {
    const parsed = schema.safeParse(stored[key]);
    out[key] = parsed.success ? parsed.data : schema.parse(undefined);
  }
  return out as TenantSettings;
}

/** PATCH /settings: any part; a part that is sent replaces that whole part. */
export const TenantSettingsPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    branding: sections.branding.optional(),
    hero: sections.hero.optional(),
    pages: sections.pages.optional(),
    contact: sections.contact.optional(),
    social: sections.social.optional(),
    locale: z.enum(["ar", "en"]).optional(),
    timezone: z.string().refine(isTimezone, "Unknown timezone").optional(),
    defaultMaxDevices: z.number().int().min(1).max(MAX_DEFAULT_DEVICES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");
export type TenantSettingsPatch = z.infer<typeof TenantSettingsPatchSchema>;

/** GET/PATCH /settings (teacher): everything, plus public URLs for the images. */
export type TenantSettingsResponse = TenantSettings & {
  name: string;
  urls: { logo: string | null; favicon: string | null; heroImage: string | null };
};

/** GET /public/settings: what the public site needs. No device limit, no asset ids. */
export type PublicSettingsResponse = {
  name: string;
  branding: {
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
  };
  hero: { title: string; subtitle: string; imageUrl: string | null };
  pages: TenantSettings["pages"];
  contact: TenantSettings["contact"];
  social: TenantSettings["social"];
  locale: TenantSettings["locale"];
  timezone: string;
};
