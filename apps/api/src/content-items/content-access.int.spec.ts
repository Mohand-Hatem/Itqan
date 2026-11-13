// Step 7.6: student tree, signed content links, download policy (FR-C04, C05, C06).
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import type { ContentAccessResponse, StudentTreeNode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { R2_ENV_NAMES } from "../storage/r2-config.js";
import { StorageService } from "../storage/storage.service.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const hasR2 = R2_ENV_NAMES.every((name) => process.env[name]);
// Without real keys the API still signs links (signing is local); only the R2 tests skip.
if (!hasR2) {
  Object.assign(process.env, {
    R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
    R2_ACCESS_KEY_ID: "test-access-key-id",
    R2_SECRET_ACCESS_KEY: "test-secret-access-key-not-real",
    R2_PRIVATE_BUCKET: "itqan-test-private",
    R2_PUBLIC_BUCKET: "itqan-test-public",
    R2_PUBLIC_URL: "https://pub-test.r2.dev",
  });
}
const fx = studentFixtures("AccessTestPassword123!");
const storage = new StorageService();
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

type Item = { id: string };
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A published course with a teacher, and an enrolled student (cookies) of the same tenant. */
async function setup() {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const send = (cookie: string, method: string, path: string, body?: unknown) =>
    http.send(`${t.slug}.localhost`, method, `/api${path}`, body, { cookie });
  const asTeacher = (method: string, path: string, body?: unknown) =>
    send(teacher.cookie, method, path, body);
  const courseId = ((await asTeacher("POST", "/courses", { title: "Course" })).body as Item).id;
  await asTeacher("PATCH", `/courses/${courseId}`, { status: "published" });

  const student = await fx.member(t.id, "student");
  const login = await fx.studentLogin(t, student.user.email);
  const enrollment = await systemPrisma.enrollment.create({
    data: {
      tenantId: t.id,
      membershipId: student.membership.id,
      courseId,
      source: "manual",
      grantedBy: teacher.user.id,
    },
  });
  const asStudent = (method: string, path: string, body?: unknown) =>
    send(login.cookies, method, path, body);

  const asset = async (mimeType = PDF, over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await systemPrisma.mediaAsset.create({
      data: {
        id,
        tenantId: t.id,
        purpose: "content",
        storageKey: `tenants/${t.id}/${id}`,
        originalName: mimeType === "video/mp4" ? "lesson.mp4" : "lesson.pdf",
        mimeType,
        fileSize: 100n,
        status: "ready",
        uploadedBy: teacher.user.id,
        ...over,
      },
    });
    return id;
  };
  /** Adds an item; published unless told otherwise. */
  const add = async (
    title: string,
    parentId: string | null = null,
    opts: { kind?: string; assetId?: string; published?: boolean } = {},
  ) => {
    const res = await asTeacher("POST", "/content-items", {
      courseId,
      parentId,
      kind: opts.kind ?? "folder",
      title,
      assetId: opts.assetId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const item = res.body as Item;
    if (opts.published !== false) {
      await asTeacher("PATCH", `/content-items/${item.id}`, { published: true });
    }
    return item;
  };
  return { t, teacher, student, enrollment, courseId, asTeacher, asStudent, asset, add };
}

describe("GET /api/courses/:id/tree as a student", () => {
  it("shows only published items whose parents are all published, with file types", async () => {
    const s = await setup();
    const unit = await s.add("Unit");
    await s.add("Notes", unit.id, { kind: "file", assetId: await s.asset() });
    await s.add("Draft notes", unit.id, {
      kind: "file",
      assetId: await s.asset(),
      published: false,
    });
    const hidden = await s.add("Hidden unit", null, { published: false });
    await s.add("Inside hidden", hidden.id);
    const gone = await s.add("Deleted unit");
    await s.asTeacher("DELETE", `/content-items/${gone.id}`);

    const res = await s.asStudent("GET", `/courses/${s.courseId}/tree`);
    expect(res.status).toBe(200);
    const tree = res.body as StudentTreeNode[];
    expect(tree).toEqual([
      {
        id: unit.id,
        kind: "folder",
        title: "Unit",
        mimeType: null,
        children: [
          { id: expect.any(String), kind: "file", title: "Notes", mimeType: PDF, children: [] },
        ],
      },
    ]);
  });

  it("403 for a student who is not enrolled, whose enrollment ended, or whose course is a draft", async () => {
    const s = await setup();
    const other = await fx.member(s.t.id, "student");
    const otherLogin = await fx.studentLogin(s.t, other.user.email);
    const notEnrolled = await http.send(
      `${s.t.slug}.localhost`,
      "GET",
      `/api/courses/${s.courseId}/tree`,
      undefined,
      { cookie: otherLogin.cookies },
    );
    expect(notEnrolled.status).toBe(403);
    expect(reasonOf(notEnrolled.body)).toBe("ENROLLMENT_REQUIRED");

    await s.asTeacher("PATCH", `/courses/${s.courseId}`, { status: "draft" });
    const draft = await s.asStudent("GET", `/courses/${s.courseId}/tree`);
    expect(draft.status).toBe(403);
    expect(reasonOf(draft.body)).toBe("COURSE_NOT_PUBLISHED");

    await s.asTeacher("PATCH", `/courses/${s.courseId}`, { status: "archived" });
    expect((await s.asStudent("GET", `/courses/${s.courseId}/tree`)).status).toBe(200);

    await systemPrisma.enrollment.update({
      where: { id: s.enrollment.id },
      data: { status: "terminated", terminatedAt: new Date() },
    });
    const ended = await s.asStudent("GET", `/courses/${s.courseId}/tree`);
    expect(ended.status).toBe(403);
    expect(reasonOf(ended.body)).toBe("ENROLLMENT_TERMINATED");
  });
});

describe("GET /api/content-items/:id/access", () => {
  const minutesLeft = (body: ContentAccessResponse) =>
    (new Date(body.expiresAt).getTime() - Date.now()) / 60_000;

  it("view-only PDF: a 5-minute view link, no download link, no watermark", async () => {
    const s = await setup();
    const item = await s.add("Notes", null, { kind: "file", assetId: await s.asset() });
    const res = await s.asStudent("GET", `/content-items/${item.id}/access`);
    expect(res.status).toBe(200);
    const body = res.body as ContentAccessResponse;
    expect(body).toMatchObject({ kind: "file", mimeType: PDF, downloadUrl: null, watermark: null });
    expect(body.viewUrl).toContain("X-Amz-Expires=300");
    expect(minutesLeft(body)).toBeGreaterThan(4.9);
    expect(minutesLeft(body)).toBeLessThanOrEqual(5);
  });

  it("downloadable PDF: both links; DOCX: download link only; MP4: 4-hour view link and watermark", async () => {
    const s = await setup();
    const pdf = await s.add("PDF", null, {
      kind: "file",
      assetId: await s.asset(PDF, { downloadPolicy: "downloadable" }),
    });
    const docx = await s.add("DOCX", null, { kind: "file", assetId: await s.asset(DOCX) });
    const video = await s.add("Video", null, {
      kind: "video",
      assetId: await s.asset("video/mp4", { downloadPolicy: "downloadable" }),
    });
    const get = async (id: string) =>
      (await s.asStudent("GET", `/content-items/${id}/access`)).body as ContentAccessResponse;

    const p = await get(pdf.id);
    expect(p.viewUrl).toContain("inline");
    expect(p.downloadUrl).toContain("attachment");

    const d = await get(docx.id);
    expect(d.viewUrl).toBeNull();
    expect(d.downloadUrl).toContain("attachment");

    const v = await get(video.id);
    expect(v.viewUrl).toContain("X-Amz-Expires=14400");
    expect(v.downloadUrl).toBeNull();
    expect(v.watermark).toEqual({ name: s.student.user.name, email: s.student.user.email });
    expect(minutesLeft(v)).toBeGreaterThan(239);
  });

  it("404 for a student on unpublished items, items under unpublished folders, deleted items and folders", async () => {
    const s = await setup();
    const draft = await s.add("Draft", null, {
      kind: "file",
      assetId: await s.asset(),
      published: false,
    });
    const closed = await s.add("Closed", null, { published: false });
    const inside = await s.add("Inside", closed.id, { kind: "file", assetId: await s.asset() });
    const deleted = await s.add("Deleted", null, { kind: "file", assetId: await s.asset() });
    await s.asTeacher("DELETE", `/content-items/${deleted.id}`);
    const folder = await s.add("Folder");

    for (const id of [draft.id, inside.id, deleted.id, folder.id]) {
      const res = await s.asStudent("GET", `/content-items/${id}/access`);
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("CONTENT_ITEM_NOT_FOUND");
    }
    // Staff can preview unpublished content.
    expect((await s.asTeacher("GET", `/content-items/${draft.id}/access`)).status).toBe(200);
  });

  it("refuses a new link once the enrollment ends (403)", async () => {
    const s = await setup();
    const item = await s.add("Notes", null, { kind: "file", assetId: await s.asset() });
    expect((await s.asStudent("GET", `/content-items/${item.id}/access`)).status).toBe(200);
    await systemPrisma.enrollment.update({
      where: { id: s.enrollment.id },
      data: { status: "terminated", terminatedAt: new Date() },
    });
    const res = await s.asStudent("GET", `/content-items/${item.id}/access`);
    expect(res.status).toBe(403);
    expect(reasonOf(res.body)).toBe("ENROLLMENT_TERMINATED");
  });

  it("another tenant gets 404 for the item and the course tree", async () => {
    const a = await setup();
    const b = await setup();
    const item = await a.add("Notes", null, { kind: "file", assetId: await a.asset() });
    expect((await b.asTeacher("GET", `/content-items/${item.id}/access`)).status).toBe(404);
    expect((await b.asStudent("GET", `/content-items/${item.id}/access`)).status).toBe(404);
    expect((await b.asStudent("GET", `/courses/${a.courseId}/tree`)).status).toBe(404);
  });
});

describe("PATCH /api/uploads/:id (download policy)", () => {
  it("staff switch a file to downloadable with an audit entry; students get 403; others 404", async () => {
    const s = await setup();
    const b = await setup();
    const assetId = await s.asset();

    const res = await s.asTeacher("PATCH", `/uploads/${assetId}`, {
      downloadPolicy: "downloadable",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: assetId, downloadPolicy: "downloadable" });
    const audit = await systemPrisma.auditLog.findFirst({ where: { targetId: assetId } });
    expect(audit).toMatchObject({ action: "media.update", actorUserId: s.teacher.user.id });

    const student = await s.asStudent("PATCH", `/uploads/${assetId}`, {
      downloadPolicy: "view_only",
    });
    expect(student.status).toBe(403);
    const other = await b.asTeacher("PATCH", `/uploads/${assetId}`, {
      downloadPolicy: "view_only",
    });
    expect(other.status).toBe(404);
    expect(reasonOf(other.body)).toBe("ASSET_NOT_FOUND");
    const bad = await s.asTeacher("PATCH", `/uploads/${assetId}`, { downloadPolicy: "public" });
    expect(bad.status).toBe(400);
    expect(
      await systemPrisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } }),
    ).toMatchObject({ downloadPolicy: "downloadable" });
  });
});

describe.skipIf(!hasR2)("links against R2", { retry: 1 }, () => {
  it("the view link serves the file inline as its type, the download link as an attachment, and links expire", async () => {
    const s = await setup();
    const body = "%PDF-1.4 itqan access test";
    const assetId = await s.asset(PDF, {
      downloadPolicy: "downloadable",
      fileSize: BigInt(body.length),
      originalName: "درس 1.pdf",
    });
    const key = `tenants/${s.t.id}/${assetId}`;
    const put = await storage.presignPut("private", key, { contentType: PDF });
    expect(
      (await fetch(put.url, { method: "PUT", body, headers: { "Content-Type": PDF } })).status,
    ).toBe(200);
    try {
      const item = await s.add("Notes", null, { kind: "file", assetId });
      const links = (await s.asStudent("GET", `/content-items/${item.id}/access`))
        .body as ContentAccessResponse;

      const view = await fetch(links.viewUrl!);
      expect(view.status).toBe(200);
      expect(view.headers.get("content-type")).toBe(PDF);
      expect(view.headers.get("content-disposition")).toMatch(/^inline;/);
      expect(view.headers.get("content-disposition")).toContain(
        `filename*=UTF-8''${encodeURIComponent("درس 1.pdf")}`,
      );
      expect(await view.text()).toBe(body);

      const download = await fetch(links.downloadUrl!);
      expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
      await download.arrayBuffer();

      const short = await storage.presignGet("private", key, {
        expiresIn: 1,
        contentType: PDF,
        disposition: "inline",
      });
      await new Promise((r) => setTimeout(r, 2500));
      expect((await fetch(short.url)).status).toBe(403);
    } finally {
      await storage.delete("private", key);
    }
  });
});
