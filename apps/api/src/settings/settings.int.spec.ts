// Step 7.11: tenant settings (FR-T06), HTML cleaning, default device limit for new students.
import { randomUUID } from "node:crypto";
import { getLastSentEmail } from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import type { PublicSettingsResponse, TenantSettingsResponse } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { R2_ENV_NAMES } from "../storage/r2-config.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

// Public image URLs need R2_PUBLIC_URL; signing and URLs are local, so fake values do when unset.
if (!R2_ENV_NAMES.every((name) => process.env[name])) {
  Object.assign(process.env, {
    R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    R2_ACCESS_KEY_ID: "test-access-key-id",
    R2_SECRET_ACCESS_KEY: "test-secret-access-key-not-real",
    R2_PRIVATE_BUCKET: "itqan-test-private",
    R2_PUBLIC_BUCKET: "itqan-test-public",
    R2_PUBLIC_URL: "https://pub-test.r2.dev",
  });
}
const fx = studentFixtures("SettingsTestPassword123!");
const createdUserIds: string[] = [];
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await systemPrisma.$disconnect();
});

type Tenant = { id: string; slug: string };
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const send = (t: Tenant, method: string, path: string, body?: unknown, cookie?: string) =>
  http.send(`${t.slug}.localhost`, method, `/api${path}`, body, cookie ? { cookie } : undefined);

async function setup() {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const asTeacher = (method: string, path: string, body?: unknown) =>
    send(t, method, path, body, teacher.cookie);
  const image = async (over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await systemPrisma.mediaAsset.create({
      data: {
        id,
        tenantId: t.id,
        purpose: "public",
        storageKey: `tenants/${t.id}/${id}`,
        originalName: "logo.png",
        mimeType: "image/png",
        fileSize: 10n,
        status: "ready",
        uploadedBy: teacher.user.id,
        ...over,
      },
    });
    return id;
  };
  return { t, teacher, asTeacher, image };
}

describe("settings", () => {
  it("reads defaults for a new tenant", async () => {
    const s = await setup();
    const res = await s.asTeacher("GET", "/settings");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Student Test Tenant",
      locale: "ar",
      timezone: "Africa/Cairo",
      defaultMaxDevices: 1,
      urls: { logo: null, favicon: null, heroImage: null },
    });
  });

  it("strips <script>, event handlers and javascript: links from page HTML on save", async () => {
    const s = await setup();
    const res = await s.asTeacher("PATCH", "/settings", {
      pages: {
        aboutHtml:
          '<p onclick="steal()">عن المدرس<script>alert(document.cookie)</script></p><a href="javascript:alert(1)">x</a>',
        howItWorksHtml: "<h2>Steps</h2><ol><li>Join</li></ol>",
      },
    });
    expect(res.status).toBe(200);
    const stored = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: s.t.id } });
    const pages = (stored.settings as { pages: { aboutHtml: string; howItWorksHtml: string } })
      .pages;
    expect(pages.aboutHtml).toBe('<p>عن المدرس</p><a rel="noopener nofollow">x</a>');
    expect(pages.howItWorksHtml).toBe("<h2>Steps</h2><ol><li>Join</li></ol>");
  });

  it("a part replaces that whole part; other parts stay; the name changes; one audit entry per save", async () => {
    const s = await setup();
    await s.asTeacher("PATCH", "/settings", {
      hero: { title: "Welcome", subtitle: "Learn" },
      contact: { phone: "+20 100" },
    });
    const res = await s.asTeacher("PATCH", "/settings", {
      name: "Dr. Ahmed Academy",
      hero: { title: "Hello" },
      locale: "en",
      defaultMaxDevices: 2,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Dr. Ahmed Academy",
      hero: { title: "Hello", subtitle: "" },
      contact: { phone: "+20 100" },
      locale: "en",
      defaultMaxDevices: 2,
    });
    const audits = await systemPrisma.auditLog.findMany({
      where: { tenantId: s.t.id, action: "tenant.settings_update" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ actorUserId: s.teacher.user.id });
    expect((audits[1]!.meta as { changed: string[] }).changed).toEqual([
      "defaultMaxDevices",
      "hero",
      "locale",
      "name",
    ]);
  });

  it("uses this tenant's ready public images and returns their public URLs", async () => {
    const s = await setup();
    const other = await setup();
    const logo = await s.image();
    const res = await s.asTeacher("PATCH", "/settings", { branding: { logoAssetId: logo } });
    expect(res.status).toBe(200);
    const body = res.body as TenantSettingsResponse;
    expect(body.urls.logo).toBe(`${process.env["R2_PUBLIC_URL"]}/tenants/${s.t.id}/${logo}`);

    for (const assetId of [
      await other.image(), // another tenant's
      await s.image({ status: "pending" }),
      await s.image({ purpose: "content", mimeType: "application/pdf" }),
      randomUUID(),
    ]) {
      const bad = await s.asTeacher("PATCH", "/settings", { hero: { imageAssetId: assetId } });
      expect(bad.status).toBe(400);
      expect(reasonOf(bad.body)).toBe("ASSET_NOT_USABLE");
    }
  });

  it("rejects bad values with 400 INVALID_BODY and keeps the stored settings", async () => {
    const s = await setup();
    for (const body of [
      { branding: { primaryColor: "red" } },
      { social: { facebook: "http://facebook.com/x" } },
      { timezone: "Not/AZone" },
      { defaultMaxDevices: 9 },
      { slug: "takeover" },
      {},
    ]) {
      const res = await s.asTeacher("PATCH", "/settings", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(reasonOf(res.body)).toBe("INVALID_BODY");
    }
    const row = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: s.t.id } });
    expect(row.settings).toEqual({});
  });

  it("only the teacher reads or edits settings (assistant and student get 403)", async () => {
    const s = await setup();
    const assistant = await fx.staffLogin(s.t, "assistant");
    const { user } = await fx.member(s.t.id, "student");
    const student = await fx.studentLogin(s.t, user.email);
    for (const cookie of [assistant.cookie, student.cookies]) {
      for (const [method, body] of [
        ["GET", undefined],
        ["PATCH", { locale: "en" }],
      ] as const) {
        const res = await send(s.t, method, "/settings", body, cookie);
        expect(res.status).toBe(403);
        expect(reasonOf(res.body)).toBe("ROLE_FORBIDDEN");
      }
    }
  });

  it("the public endpoint needs no login, shows URLs, and hides private fields", async () => {
    const s = await setup();
    const logo = await s.image();
    await s.asTeacher("PATCH", "/settings", {
      branding: { logoAssetId: logo, primaryColor: "#112233" },
      social: { youtube: "https://youtube.com/@t" },
      defaultMaxDevices: 3,
    });
    const res = await send(s.t, "GET", "/public/settings");
    expect(res.status).toBe(200);
    const body = res.body as PublicSettingsResponse;
    expect(body.branding).toEqual({
      logoUrl: `${process.env["R2_PUBLIC_URL"]}/tenants/${s.t.id}/${logo}`,
      faviconUrl: null,
      primaryColor: "#112233",
      secondaryColor: null,
    });
    expect(body.social.youtube).toBe("https://youtube.com/@t");
    expect(JSON.stringify(body)).not.toMatch(/defaultMaxDevices|AssetId/);
  });

  it("another tenant's teacher only ever sees and changes their own settings", async () => {
    const a = await setup();
    const b = await setup();
    await a.asTeacher("PATCH", "/settings", { hero: { title: "A's site" } });
    await b.asTeacher("PATCH", "/settings", { hero: { title: "B's site" } });
    // B's cookie on A's host: no membership there.
    const cross = await send(a.t, "PATCH", "/settings", { hero: { title: "x" } }, b.teacher.cookie);
    expect(cross.status).toBe(403);
    const aPublic = (await send(a.t, "GET", "/public/settings")).body as PublicSettingsResponse;
    expect(aPublic.hero.title).toBe("A's site");
  });

  it("a brand-new student joining by invitation gets the tenant's default device limit", async () => {
    const s = await setup();
    await s.asTeacher("PATCH", "/settings", { defaultMaxDevices: 3 });
    const email = `settings-${randomUUID().slice(0, 8)}@example.com`;
    const course = await systemPrisma.course.create({ data: { tenantId: s.t.id, title: "C" } });
    const created = await s.asTeacher("POST", "/invitations", { email, courseIds: [course.id] });
    expect(created.status).toBe(201);
    const token = getLastSentEmail(email)!.token!;
    const reg = await send(s.t, "POST", "/register", {
      token,
      name: "New Student",
      password: "ValidPassword123!",
    });
    expect(reg.status).toBe(201);
    const user = await systemPrisma.user.findUniqueOrThrow({ where: { email } });
    createdUserIds.push(user.id);
    expect(user.maxDevices).toBe(3);
  });
});
