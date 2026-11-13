// Step 7.10: PUT /progress/:itemId and GET /courses/:id/progress (FR-C07).
import { randomUUID } from "node:crypto";
import { type ContentKind, systemPrisma } from "@itqan/database";
import type { CourseProgressResponse, ItemProgress } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("ProgressTestPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;

/** A published course with an enrolled student; items are written straight to the database. */
async function setup() {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const course = await systemPrisma.course.create({
    data: { tenantId: t.id, title: "Course", status: "published" },
  });
  const enrolled = async () => {
    const m = await fx.member(t.id, "student");
    const login = await fx.studentLogin(t, m.user.email);
    const enrollment = await systemPrisma.enrollment.create({
      data: {
        tenantId: t.id,
        membershipId: m.membership.id,
        courseId: course.id,
        source: "manual",
        grantedBy: teacher.user.id,
      },
    });
    const as = (method: string, path: string, body?: unknown) =>
      http.send(`${t.slug}.localhost`, method, `/api${path}`, body, { cookie: login.cookies });
    return { ...m, enrollment, as };
  };
  let order = 0;
  const item = async (kind: ContentKind, opts: { parentId?: string; published?: boolean } = {}) => {
    let assetId: string | null = null;
    if (kind === "file" || kind === "video") {
      assetId = randomUUID();
      await systemPrisma.mediaAsset.create({
        data: {
          id: assetId,
          tenantId: t.id,
          purpose: "content",
          storageKey: `tenants/${t.id}/${assetId}`,
          originalName: "x",
          mimeType: kind === "video" ? "video/mp4" : "application/pdf",
          fileSize: 1n,
          status: "ready",
          uploadedBy: teacher.user.id,
        },
      });
    }
    return systemPrisma.contentItem.create({
      data: {
        tenantId: t.id,
        courseId: course.id,
        parentId: opts.parentId ?? null,
        kind,
        title: kind,
        sortOrder: order++,
        depth: opts.parentId ? 2 : 1,
        assetId,
        publishedAt: opts.published === false ? null : new Date(),
      },
    });
  };
  const staffAs = (method: string, path: string, body?: unknown) =>
    http.send(`${t.slug}.localhost`, method, `/api${path}`, body, { cookie: teacher.cookie });
  return { t, course, enrolled, item, staffAs };
}

describe("progress", () => {
  it("saves a video position and returns it as the resume point; saving again updates the same row", async () => {
    const s = await setup();
    const student = await s.enrolled();
    const video = await s.item("video");

    const put = await student.as("PUT", `/progress/${video.id}`, { videoPositionSec: 125 });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ itemId: video.id, videoPositionSec: 125, completed: false });

    let progress = (await student.as("GET", `/courses/${s.course.id}/progress`))
      .body as CourseProgressResponse;
    expect(progress.resume).toEqual({ itemId: video.id, videoPositionSec: 125 });

    await student.as("PUT", `/progress/${video.id}`, { videoPositionSec: 300 });
    progress = (await student.as("GET", `/courses/${s.course.id}/progress`))
      .body as CourseProgressResponse;
    expect(progress.resume).toEqual({ itemId: video.id, videoPositionSec: 300 });
    expect(progress.items).toHaveLength(1);
    expect(await systemPrisma.lessonProgress.count({ where: { contentItemId: video.id } })).toBe(1);
  });

  it("completed keeps its first time, can be cleared, and completed items are not the resume point", async () => {
    const s = await setup();
    const student = await s.enrolled();
    const [file, video] = [await s.item("file"), await s.item("video")];
    const put = async (id: string, body: unknown) =>
      (await student.as("PUT", `/progress/${id}`, body)).body as ItemProgress;

    await put(video.id, { videoPositionSec: 60 });
    const first = await put(file.id, { completed: true });
    expect(first.completed).toBe(true);
    expect((await put(file.id, { completed: true })).completedAt).toBe(first.completedAt);

    // The file was touched last but is completed: resume goes to the video.
    let progress = (await student.as("GET", `/courses/${s.course.id}/progress`))
      .body as CourseProgressResponse;
    expect(progress.resume).toEqual({ itemId: video.id, videoPositionSec: 60 });

    // A position save does not touch completed; completing the video leaves no resume point.
    await put(video.id, { completed: true });
    const after = await put(video.id, { videoPositionSec: 90 });
    expect(after).toMatchObject({ completed: true, videoPositionSec: 90 });
    progress = (await student.as("GET", `/courses/${s.course.id}/progress`))
      .body as CourseProgressResponse;
    expect(progress.resume).toBeNull();

    expect(await put(file.id, { completed: false })).toMatchObject({
      completed: false,
      completedAt: null,
    });
  });

  it("refuses positions on non-videos, folders, and bad bodies (400)", async () => {
    const s = await setup();
    const student = await s.enrolled();
    const [file, folder, video] = [
      await s.item("file"),
      await s.item("folder"),
      await s.item("video"),
    ];
    const cases: [string, unknown, string][] = [
      [file.id, { videoPositionSec: 10 }, "NOT_A_VIDEO"],
      [folder.id, { completed: true }, "NOT_TRACKABLE"],
      [video.id, {}, "INVALID_BODY"],
      [video.id, { videoPositionSec: -1 }, "INVALID_BODY"],
      [video.id, { videoPositionSec: 86_401 }, "INVALID_BODY"],
      [video.id, { videoPositionSec: 1.5 }, "INVALID_BODY"],
      [video.id, { completed: true, membershipId: randomUUID() }, "INVALID_BODY"],
    ];
    for (const [id, body, reason] of cases) {
      const res = await student.as("PUT", `/progress/${id}`, body);
      expect(res.status, reason).toBe(400);
      expect(reasonOf(res.body)).toBe(reason);
    }
  });

  it("hidden items are 404, and progress on items hidden later is left out", async () => {
    const s = await setup();
    const student = await s.enrolled();
    const draft = await s.item("video", { published: false });
    const closed = await s.item("folder", { published: false });
    const inside = await s.item("video", { parentId: closed.id });
    for (const id of [draft.id, inside.id, randomUUID()]) {
      const res = await student.as("PUT", `/progress/${id}`, { completed: true });
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("CONTENT_ITEM_NOT_FOUND");
    }

    const video = await s.item("video");
    await student.as("PUT", `/progress/${video.id}`, { videoPositionSec: 5 });
    await systemPrisma.contentItem.update({ where: { id: video.id }, data: { publishedAt: null } });
    const progress = (await student.as("GET", `/courses/${s.course.id}/progress`))
      .body as CourseProgressResponse;
    expect(progress).toEqual({ items: [], resume: null });
    // Kept in the table (docs/06: progress stays).
    expect(await systemPrisma.lessonProgress.count({ where: { contentItemId: video.id } })).toBe(1);
  });

  it("403 when not enrolled or the enrollment ended (progress is kept); staff get 403", async () => {
    const s = await setup();
    const video = await s.item("video");
    const student = await s.enrolled();
    await student.as("PUT", `/progress/${video.id}`, { videoPositionSec: 5 });

    const stranger = await fx.member(s.t.id, "student");
    const strangerLogin = await fx.studentLogin(s.t, stranger.user.email);
    const notEnrolled = await http.send(
      `${s.t.slug}.localhost`,
      "PUT",
      `/api/progress/${video.id}`,
      { videoPositionSec: 1 },
      { cookie: strangerLogin.cookies },
    );
    expect(notEnrolled.status).toBe(403);
    expect(reasonOf(notEnrolled.body)).toBe("ENROLLMENT_REQUIRED");

    await systemPrisma.enrollment.update({
      where: { id: student.enrollment.id },
      data: { status: "terminated", terminatedAt: new Date() },
    });
    for (const res of [
      await student.as("PUT", `/progress/${video.id}`, { videoPositionSec: 9 }),
      await student.as("GET", `/courses/${s.course.id}/progress`),
    ]) {
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe("ENROLLMENT_TERMINATED");
    }
    expect(
      await systemPrisma.lessonProgress.findFirst({ where: { contentItemId: video.id } }),
    ).toMatchObject({ videoPositionSec: 5 });

    const staff = await s.staffAs("PUT", `/progress/${video.id}`, { videoPositionSec: 1 });
    expect(staff.status).toBe(403);
    expect(reasonOf(staff.body)).toBe("ROLE_FORBIDDEN");
  });

  it("a super admin with no membership here gets 403, not a crash (Phase 7 audit)", async () => {
    const s = await setup();
    const video = await s.item("video");
    const admin = await fx.staffLogin(s.t, "teacher", { superAdmin: true });
    const as = (method: string, path: string, body?: unknown) =>
      http.send(`${s.t.slug}.localhost`, method, `/api${path}`, body, { cookie: admin.cookie });
    for (const res of [
      await as("PUT", `/progress/${video.id}`, { completed: true }),
      await as("GET", `/courses/${s.course.id}/progress`),
    ]) {
      expect(res.status).toBe(403);
      expect(reasonOf(res.body)).toBe("ROLE_FORBIDDEN");
    }
  });

  it("each student sees only their own progress; another tenant gets 404", async () => {
    const s = await setup();
    const other = await setup();
    const video = await s.item("video");
    const alice = await s.enrolled();
    const bob = await s.enrolled();
    await alice.as("PUT", `/progress/${video.id}`, { videoPositionSec: 77 });

    const bobs = (await bob.as("GET", `/courses/${s.course.id}/progress`))
      .body as CourseProgressResponse;
    expect(bobs).toEqual({ items: [], resume: null });

    const outsider = await other.enrolled();
    expect((await outsider.as("PUT", `/progress/${video.id}`, { completed: true })).status).toBe(
      404,
    );
    expect((await outsider.as("GET", `/courses/${s.course.id}/progress`)).status).toBe(404);
  });
});
