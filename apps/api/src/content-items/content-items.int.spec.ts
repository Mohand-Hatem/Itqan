// Step 7.4: content tree API (FR-C01, FR-C02).
import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, type ContentTreeNode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const fx = studentFixtures("ContentTestPassword123!");
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

type Tenant = { id: string; slug: string };
type Item = { id: string; depth: number; sortOrder: number; parentId: string | null };
const reasonOf = (body: unknown) => (body as { reason?: string }).reason;

/** A tenant with a teacher session, a course and helpers that call the API as that teacher. */
async function setup() {
  const t = await fx.tenant();
  const teacher = await fx.staffLogin(t, "teacher");
  const as = (
    method: string,
    path: string,
    body?: unknown,
    tenant: Tenant = t,
    cookie = teacher.cookie,
  ) => http.send(`${tenant.slug}.localhost`, method, `/api${path}`, body, { cookie });
  const courseId = ((await as("POST", "/courses", { title: "Tree course" })).body as { id: string })
    .id;
  const add = async (
    title: string,
    parentId: string | null = null,
    kind = "folder",
    assetId?: string,
  ) => {
    const res = await as("POST", "/content-items", { courseId, parentId, kind, title, assetId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as Item;
  };
  const asset = async (over: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await systemPrisma.mediaAsset.create({
      data: {
        id,
        tenantId: t.id,
        purpose: "content",
        storageKey: `tenants/${t.id}/${id}`,
        originalName: "lesson.pdf",
        mimeType: "application/pdf",
        fileSize: 100n,
        status: "ready",
        uploadedBy: teacher.user.id,
        ...over,
      },
    });
    return id;
  };
  const tree = async () => (await as("GET", `/courses/${courseId}/tree`)).body as ContentTreeNode[];
  const row = (id: string) => systemPrisma.contentItem.findUniqueOrThrow({ where: { id } });
  return { t, teacher, as, courseId, add, asset, tree, row };
}

describe("POST /api/content-items", () => {
  it("builds a nested tree in order, with depth, sort order and audit entries", async () => {
    const s = await setup();
    const folder = await s.add("Unit 1");
    const chapter = await s.add("Chapter 1", folder.id, "chapter");
    const lecture = await s.add("Lecture 1", chapter.id, "lecture");
    const pdf = await s.add("Notes", lecture.id, "file", await s.asset());
    const video = await s.add(
      "Recording",
      lecture.id,
      "video",
      await s.asset({ mimeType: "video/mp4" }),
    );
    await s.add("Unit 2");

    expect([folder.depth, chapter.depth, lecture.depth, pdf.depth]).toEqual([1, 2, 3, 4]);
    expect([pdf.sortOrder, video.sortOrder]).toEqual([0, 1]);

    const tree = await s.tree();
    expect(tree.map((n) => n.title)).toEqual(["Unit 1", "Unit 2"]);
    const lectureNode = tree[0]!.children[0]!.children[0]!;
    expect(lectureNode.children.map((n) => n.title)).toEqual(["Notes", "Recording"]);

    const audit = await systemPrisma.auditLog.findFirst({ where: { targetId: folder.id } });
    expect(audit).toMatchObject({ action: "content.create", actorUserId: s.teacher.user.id });
  });

  it("allows 5 levels and refuses a 6th with 409 TREE_TOO_DEEP", async () => {
    const s = await setup();
    let parent: string | null = null;
    for (let level = 1; level <= 5; level++) parent = (await s.add(`L${level}`, parent)).id;
    const res = await s.as("POST", "/content-items", {
      courseId: s.courseId,
      parentId: parent,
      kind: "folder",
      title: "L6",
    });
    expect(res.status).toBe(409);
    expect(reasonOf(res.body)).toBe("TREE_TOO_DEEP");
  });

  it("refuses bad parents and unusable assets", async () => {
    const s = await setup();
    const other = await setup();
    const folder = await s.add("Folder");
    const file = await s.add("File", folder.id, "file", await s.asset());
    const otherCourse = (await s.as("POST", "/courses", { title: "Other" })).body as { id: string };
    const otherFolder = (
      await s.as("POST", "/content-items", {
        courseId: otherCourse.id,
        kind: "folder",
        title: "x",
      })
    ).body as Item;

    const post = (body: Record<string, unknown>) =>
      s.as("POST", "/content-items", { courseId: s.courseId, title: "x", ...body });
    const cases: [Record<string, unknown>, number, string][] = [
      [{ kind: "file" }, 400, "INVALID_BODY"], // a file needs an asset
      [{ kind: "folder", assetId: await s.asset() }, 400, "INVALID_BODY"],
      [{ kind: "folder", parentId: file.id }, 400, "INVALID_PARENT"], // files hold nothing
      [{ kind: "folder", parentId: otherFolder.id }, 400, "INVALID_PARENT"], // other course
      [{ kind: "video", assetId: await s.asset() }, 400, "ASSET_NOT_USABLE"], // PDF as video
      [
        { kind: "file", assetId: await s.asset({ mimeType: "video/mp4" }) },
        400,
        "ASSET_NOT_USABLE",
      ],
      [{ kind: "file", assetId: await s.asset({ status: "pending" }) }, 400, "ASSET_NOT_USABLE"],
      [
        { kind: "file", assetId: await s.asset({ purpose: "public", mimeType: "image/png" }) },
        400,
        "ASSET_NOT_USABLE",
      ],
      [{ kind: "file", assetId: await other.asset() }, 400, "ASSET_NOT_USABLE"], // other tenant
      [{ kind: "folder", courseId: other.courseId }, 404, "COURSE_NOT_FOUND"],
    ];
    for (const [body, status, reason] of cases) {
      const res = await post(body);
      expect(res.status, reason).toBe(status);
      expect(reasonOf(res.body), JSON.stringify(body)).toBe(reason);
    }
  });

  it("students get 403 ROLE_FORBIDDEN on writes and never the staff tree", async () => {
    const s = await setup();
    const { user } = await fx.member(s.t.id, "student");
    const student = await fx.studentLogin(s.t, user.email);
    const create = await s.as(
      "POST",
      "/content-items",
      { courseId: s.courseId, kind: "folder", title: "x" },
      s.t,
      student.cookies,
    );
    const tree = await s.as("GET", `/courses/${s.courseId}/tree`, undefined, s.t, student.cookies);
    expect(create.status).toBe(403);
    expect(reasonOf(create.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    // Since 7.6 students read the tree too, but only their own view, after the enrollment checks.
    expect(tree.status).toBe(403);
    expect(reasonOf(tree.body)).toBe("ENROLLMENT_REQUIRED");
  });
});

describe("PATCH /api/content-items/:id", () => {
  it("renames, publishes and unpublishes, with audit entries", async () => {
    const s = await setup();
    const item = await s.add("Old");
    const res = await s.as("PATCH", `/content-items/${item.id}`, { title: "New", published: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "New" });
    expect((res.body as { publishedAt: string | null }).publishedAt).not.toBeNull();

    await s.as("PATCH", `/content-items/${item.id}`, { published: false });
    expect((await s.row(item.id)).publishedAt).toBeNull();
    const actions = (await systemPrisma.auditLog.findMany({ where: { targetId: item.id } })).map(
      (a) => a.action,
    );
    expect(actions.sort()).toEqual(
      ["content.create", "content.publish", "content.publish", "content.update"].sort(),
    );
  });

  it("reorders siblings and keeps their order 0..n", async () => {
    const s = await setup();
    await s.add("A");
    await s.add("B");
    const c = await s.add("C");
    await s.as("PATCH", `/content-items/${c.id}`, { position: 0 });
    expect((await s.tree()).map((n) => [n.title, n.sortOrder])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
    await s.as("PATCH", `/content-items/${c.id}`, { position: 99 });
    expect((await s.tree()).map((n) => n.title)).toEqual(["A", "B", "C"]);
  });

  it("moves a branch: depths follow, both sibling lists stay 0..n", async () => {
    const s = await setup();
    const [x, y] = [await s.add("X"), await s.add("Y")];
    const x1 = await s.add("X1", x.id);
    const x2 = await s.add("X2", x.id);
    const deep = await s.add("X2a", x2.id);
    const y1 = await s.add("Y1", y.id);

    const res = await s.as("PATCH", `/content-items/${x2.id}`, { parentId: y.id, position: 0 });
    expect(res.status).toBe(200);
    expect(await s.row(x2.id)).toMatchObject({ parentId: y.id, depth: 2, sortOrder: 0 });
    expect(await s.row(deep.id)).toMatchObject({ depth: 3 });
    expect(await s.row(y1.id)).toMatchObject({ sortOrder: 1 });
    expect(await s.row(x1.id)).toMatchObject({ sortOrder: 0 });

    // To the top of the course: the branch moves up a level.
    await s.as("PATCH", `/content-items/${x2.id}`, { parentId: null });
    expect(await s.row(x2.id)).toMatchObject({ parentId: null, depth: 1, sortOrder: 2 });
    expect(await s.row(deep.id)).toMatchObject({ depth: 2 });
  });

  it("refuses cycles (409 TREE_CYCLE) and branches that would go below level 5 (409 TREE_TOO_DEEP)", async () => {
    const s = await setup();
    const a = await s.add("A");
    const b = await s.add("B", a.id);
    const c = await s.add("C", b.id);
    for (const parentId of [a.id, c.id]) {
      const res = await s.as("PATCH", `/content-items/${a.id}`, { parentId });
      expect(res.status).toBe(409);
      expect(reasonOf(res.body)).toBe("TREE_CYCLE");
    }

    let parent: string | null = null;
    for (let level = 1; level <= 3; level++) parent = (await s.add(`L${level}`, parent)).id;
    // A's branch spans 3 levels; under L3 (level 3) it would reach level 6.
    const res = await s.as("PATCH", `/content-items/${a.id}`, { parentId: parent });
    expect(res.status).toBe(409);
    expect(reasonOf(res.body)).toBe("TREE_TOO_DEEP");
    expect(await s.row(a.id)).toMatchObject({ parentId: null, depth: 1 });
  });

  it("rejects an empty or unknown patch with 400 INVALID_BODY", async () => {
    const s = await setup();
    const item = await s.add("A");
    for (const body of [{}, { depth: 3 }, { courseId: randomUUID() }]) {
      const res = await s.as("PATCH", `/content-items/${item.id}`, body);
      expect(res.status).toBe(400);
      expect(reasonOf(res.body)).toBe("INVALID_BODY");
    }
  });
});

describe("DELETE and restore", () => {
  it("deletes a branch, lists it for restore, and brings back only what was deleted with it", async () => {
    const s = await setup();
    const a = await s.add("A");
    await s.add("B");
    const a1 = await s.add("A1", a.id);
    const a2 = await s.add("A2", a.id);
    const a1x = await s.add("A1x", a1.id);

    // A2 deleted on its own first; then the whole of A.
    expect((await s.as("DELETE", `/content-items/${a2.id}`)).status).toBe(200);
    expect((await s.as("DELETE", `/content-items/${a.id}`)).status).toBe(200);
    expect((await s.tree()).map((n) => [n.title, n.sortOrder])).toEqual([["B", 0]]);
    for (const id of [a.id, a1.id, a1x.id, a2.id]) {
      expect((await s.row(id)).deletedAt).not.toBeNull();
    }

    const trash = (await s.as("GET", `/courses/${s.courseId}/tree?deleted=true`)).body as Item[];
    expect(trash.map((i) => i.id).sort()).toEqual([a.id, a2.id].sort());

    // A2's parent is deleted: restore A first.
    const early = await s.as("POST", `/content-items/${a2.id}/restore`);
    expect(early.status).toBe(409);
    expect(reasonOf(early.body)).toBe("PARENT_DELETED");

    for (let i = 0; i < 2; i++) {
      const res = await s.as("POST", `/content-items/${a.id}/restore`);
      expect(res.status).toBe(200);
    }
    const tree = await s.tree();
    expect(tree.map((n) => [n.title, n.sortOrder])).toEqual([
      ["B", 0],
      ["A", 1],
    ]);
    expect(tree[1]!.children.map((n) => n.title)).toEqual(["A1"]);
    expect(tree[1]!.children[0]!.children.map((n) => n.title)).toEqual(["A1x"]);
    expect((await s.row(a2.id)).deletedAt).not.toBeNull();

    const actions = await systemPrisma.auditLog.findMany({
      where: { targetId: a.id, action: { in: ["content.delete", "content.restore"] } },
    });
    expect(actions).toHaveLength(2);
  });

  it("a deleted item cannot be edited or deleted again (404)", async () => {
    const s = await setup();
    const item = await s.add("A");
    await s.as("DELETE", `/content-items/${item.id}`);
    for (const [method, body] of [
      ["PATCH", { title: "x" }],
      ["DELETE", undefined],
    ] as const) {
      const res = await s.as(method, `/content-items/${item.id}`, body);
      expect(res.status).toBe(404);
      expect(reasonOf(res.body)).toBe("CONTENT_ITEM_NOT_FOUND");
    }
  });
});

describe("tenant isolation", () => {
  it("another tenant's staff get 404 on every endpoint, and the item is unchanged", async () => {
    const a = await setup();
    const b = await setup();
    const item = await a.add("A's folder");
    const asB = (method: string, path: string, body?: unknown) => b.as(method, path, body);

    const results = [
      await asB("PATCH", `/content-items/${item.id}`, { title: "hacked" }),
      await asB("DELETE", `/content-items/${item.id}`),
      await asB("POST", `/content-items/${item.id}/restore`),
      await asB("GET", `/courses/${a.courseId}/tree`),
      await asB("POST", "/content-items", { courseId: a.courseId, kind: "folder", title: "x" }),
      await asB("POST", "/content-items", {
        courseId: b.courseId,
        parentId: item.id,
        kind: "folder",
        title: "x",
      }),
    ];
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 400]);
    expect(await a.row(item.id)).toMatchObject({ title: "A's folder", deletedAt: null });
  });

  it("a deleted course's tree is 404 COURSE_NOT_FOUND", async () => {
    const s = await setup();
    await s.add("A");
    await systemPrisma.course.update({
      where: { id: s.courseId },
      data: { deletedAt: new Date() },
    });
    const res = await s.as("GET", `/courses/${s.courseId}/tree`);
    expect(res.status).toBe(404);
    expect(reasonOf(res.body)).toBe("COURSE_NOT_FOUND");
  });
});
