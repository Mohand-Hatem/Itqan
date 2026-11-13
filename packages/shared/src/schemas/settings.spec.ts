import { describe, expect, it } from "vitest";
import { TenantSettingsPatchSchema, readTenantSettings } from "./settings.js";

describe("readTenantSettings", () => {
  it("turns {} into complete defaults (Arabic, Cairo, 1 device)", () => {
    const s = readTenantSettings({});
    expect(s).toMatchObject({
      locale: "ar",
      timezone: "Africa/Cairo",
      defaultMaxDevices: 1,
      branding: { logoAssetId: null, primaryColor: null },
      hero: { title: "", imageAssetId: null },
      pages: { aboutHtml: "" },
      contact: { email: "" },
      social: { facebook: null },
    });
  });

  it("keeps valid parts and resets only a broken part", () => {
    const s = readTenantSettings({
      locale: "en",
      branding: { primaryColor: "red" },
      hero: { title: "Welcome" },
    });
    expect(s.locale).toBe("en");
    expect(s.hero.title).toBe("Welcome");
    expect(s.branding.primaryColor).toBeNull();
    expect(readTenantSettings(null).locale).toBe("ar");
  });
});

describe("TenantSettingsPatchSchema", () => {
  const ok = (v: unknown) => TenantSettingsPatchSchema.safeParse(v).success;

  it("accepts good values", () => {
    expect(
      ok({
        branding: { primaryColor: "#1a2B3c" },
        social: { youtube: "https://youtube.com/@teacher" },
        timezone: "Asia/Riyadh",
        defaultMaxDevices: 3,
        contact: { email: "teacher@example.com", phone: "+20 100 000 0000" },
      }),
    ).toBe(true);
  });

  it("rejects bad colors, non-https links, unknown timezones, limits and keys", () => {
    for (const bad of [
      {},
      { branding: { primaryColor: "red" } },
      { social: { youtube: "http://youtube.com" } },
      { social: { youtube: "javascript:alert(1)" } },
      { timezone: "Mars/Olympus" },
      { defaultMaxDevices: 0 },
      { defaultMaxDevices: 6 },
      { contact: { email: "not-an-email" } },
      { pages: { aboutHtml: "x".repeat(20_001) } },
      { slug: "other" },
      { branding: { logoAssetId: "not-a-uuid" } },
    ]) {
      expect(ok(bad), JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });
});
