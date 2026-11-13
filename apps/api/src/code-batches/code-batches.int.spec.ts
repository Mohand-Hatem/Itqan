import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "BatchTestPassword123!";
const fx = studentFixtures(PASSWORD);
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
const host = (t: Tenant) => `${t.slug}.localhost`;
const as = (t: Tenant, cookie: string, method: string, path: string, body?: unknown) =>
  http.send(host(t), method, `/api${path}`, body, { cookie });

const reasonOf = (body: unknown) => (body as { reason?: string }).reason;
const auditOf = (tenantId: string, targetId: string) =>
  systemPrisma.auditLog.findMany({ where: { tenantId, targetId } });

describe("Access Code Batches API (Integration)", () => {
  describe("POST /api/code-batches (Batch Minting)", () => {
    it("allows teacher to create a batch, returns CSV once, stores only HMAC hashes in DB", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Modern Chemistry" },
      });

      const res = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 5,
        name: "Cairo Center Hall B",
      });

      expect(res.status).toBe(201);
      const body = res.body as {
        batch: {
          id: string;
          courseId: string;
          courseTitle: string;
          name: string;
          codeCount: number;
          redeemedCount: number;
          revokedAt: string | null;
        };
        csv: string;
        codes: Array<{ serial: number; code: string }>;
      };

      expect(body.batch.courseId).toBe(course.id);
      expect(body.batch.courseTitle).toBe("Modern Chemistry");
      expect(body.batch.name).toBe("Cairo Center Hall B");
      expect(body.batch.codeCount).toBe(5);
      expect(body.batch.redeemedCount).toBe(0);
      expect(body.batch.revokedAt).toBeNull();

      expect(body.codes).toHaveLength(5);
      for (const item of body.codes) {
        expect(item.code).toMatch(
          /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
        );
      }

      // Check CSV contains header and 5 rows
      const csvLines = body.csv.trim().split("\n");
      expect(csvLines).toHaveLength(6);
      expect(csvLines[0]).toBe("Serial,Code,FormattedCode,CourseTitle,BatchId,CreatedAt");
      expect(csvLines[1]).toContain("Modern Chemistry");

      // Verify Database records: plaintext codes are NEVER stored
      const dbCodes = await systemPrisma.accessCode.findMany({
        where: { batchId: body.batch.id },
        orderBy: { serialNumber: "asc" },
      });
      expect(dbCodes).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(dbCodes[i]?.serialNumber).toBe(i + 1);
        expect(dbCodes[i]?.codeHash).toHaveLength(64); // 64 hex characters (SHA256)
        expect(dbCodes[i]?.codePrefix).toHaveLength(4);
        expect(body.codes[i]?.code.startsWith(dbCodes[i]!.codePrefix)).toBe(true);
      }

      // Verify Audit Log: zero plaintext in meta
      const audits = await auditOf(t.id, body.batch.id);
      const createAudit = audits.find((a) => a.action === "code_batch.create");
      expect(createAudit).toBeDefined();
      expect(createAudit?.actorUserId).toBe(teacher.user.id);
      expect(createAudit?.meta).toMatchObject({
        courseId: course.id,
        count: 5,
        name: "Cairo Center Hall B",
      });
      // Meta must not contain raw codes
      expect(JSON.stringify(createAudit?.meta)).not.toContain(body.codes[0]!.code);
    });

    it("rejects count out of range (count > 500 or count < 1)", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course Limits" },
      });

      const resZero = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 0,
      });
      expect(resZero.status).toBe(400);

      const resOver = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 501,
      });
      expect(resOver.status).toBe(400);
    });

    it("rejects non-existent or foreign courses with 400 INVALID_COURSE", async () => {
      const t = await fx.tenant();
      const otherTenant = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      // Foreign course
      const foreignCourse = await systemPrisma.course.create({
        data: { tenantId: otherTenant.id, title: "Other Academy Course" },
      });

      const resForeign = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: foreignCourse.id,
        count: 10,
      });
      expect(resForeign.status).toBe(400);
      expect(reasonOf(resForeign.body)).toBe("INVALID_COURSE");

      // Random UUID course
      const resNonExistent = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: randomUUID(),
        count: 10,
      });
      expect(resNonExistent.status).toBe(400);
      expect(reasonOf(resNonExistent.body)).toBe("INVALID_COURSE");
    });

    it("assistants and students receive 403 ROLE_FORBIDDEN on minting", async () => {
      const t = await fx.tenant();
      const assistant = await fx.staffLogin(t, "assistant");
      const { user: studentUser } = await fx.member(t.id, "student");
      const student = await fx.studentLogin(t, studentUser.email);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Forbidden Course" },
      });

      // Assistant gets 403
      const asstRes = await as(t, assistant.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 5,
      });
      expect(asstRes.status).toBe(403);
      expect(reasonOf(asstRes.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);

      // Student gets 403
      const studentRes = await as(t, student.cookies, "POST", "/code-batches", {
        courseId: course.id,
        count: 5,
      });
      expect(studentRes.status).toBe(403);
      expect(reasonOf(studentRes.body)).toBe(AccessReasonCode.ROLE_FORBIDDEN);
    });
  });

  describe("GET /api/code-batches (Listing & Filters)", () => {
    it("allows teacher and assistant to list batches with status filter and cursor pagination", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Tafsir Batch" },
      });

      // Create 3 batches
      const _b1 = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 2,
        name: "Batch 1",
      });
      const b2 = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 2,
        name: "Batch 2",
      });
      const _b3 = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 2,
        name: "Batch 3",
      });

      const id2 = (b2.body as { batch: { id: string } }).batch.id;

      // Revoke b2
      await as(t, teacher.cookie, "POST", `/code-batches/${id2}/revoke`);

      // Teacher lists all
      const listRes = await as(t, teacher.cookie, "GET", "/code-batches");
      expect(listRes.status).toBe(200);
      const listBody = listRes.body as { items: Array<{ id: string; isRevoked: boolean }> };
      expect(listBody.items.length).toBe(3);

      // Assistant can list (read-only)
      const asstList = await as(t, assistant.cookie, "GET", "/code-batches");
      expect(asstList.status).toBe(200);
      expect((asstList.body as { items: unknown[] }).items.length).toBe(3);

      // Filter by status=revoked
      const listRevoked = await as(t, teacher.cookie, "GET", "/code-batches?status=revoked");
      expect(listRevoked.status).toBe(200);
      const revokedItems = (listRevoked.body as { items: Array<{ id: string }> }).items;
      expect(revokedItems.length).toBe(1);
      expect(revokedItems[0]?.id).toBe(id2);

      // Filter by status=active
      const listActive = await as(t, teacher.cookie, "GET", "/code-batches?status=active");
      expect(listActive.status).toBe(200);
      const activeItems = (listActive.body as { items: Array<{ id: string }> }).items;
      expect(activeItems.length).toBe(2);

      // Cursor pagination with limit=1
      const p1 = await as(t, teacher.cookie, "GET", "/code-batches?limit=1");
      expect(p1.status).toBe(200);
      const p1Body = p1.body as { items: Array<{ id: string }>; nextCursor: string | null };
      expect(p1Body.items.length).toBe(1);
      expect(p1Body.nextCursor).toBeDefined();

      const p2 = await as(
        t,
        teacher.cookie,
        "GET",
        `/code-batches?limit=1&cursor=${p1Body.nextCursor}`,
      );
      expect(p2.status).toBe(200);
      const p2Body = p2.body as { items: Array<{ id: string }> };
      expect(p2Body.items.length).toBe(1);
      expect(p2Body.items[0]?.id).not.toBe(p1Body.items[0]?.id);
    });

    it("students receive 403 on listing", async () => {
      const t = await fx.tenant();
      const { user } = await fx.member(t.id, "student");
      const student = await fx.studentLogin(t, user.email);

      const res = await as(t, student.cookies, "GET", "/code-batches");
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/code-batches/:id/codes (Redacted Code Inspection)", () => {
    it("returns masked code representations with serial numbers and redemption metadata", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Inspection Course" },
      });

      const createRes = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 3,
      });
      const batchId = (createRes.body as { batch: { id: string } }).batch.id;

      // Simulate redemption of code serial 1 by a student
      const studentUser = await fx.user();
      await systemPrisma.accessCode.update({
        where: { tenantId_batchId_serialNumber: { tenantId: t.id, batchId, serialNumber: 1 } },
        data: {
          redeemedAt: new Date(),
          redeemedBy: studentUser.id,
        },
      });
      await systemPrisma.accessCodeBatch.update({
        where: { id: batchId },
        data: { redeemedCount: { increment: 1 } },
      });

      // Teacher inspects codes
      const codesRes = await as(t, teacher.cookie, "GET", `/code-batches/${batchId}/codes`);
      expect(codesRes.status).toBe(200);
      const body = codesRes.body as {
        batchId: string;
        items: Array<{
          serial: number;
          codeMasked: string;
          status: string;
          redeemedAt: string | null;
          redeemedBy: { id: string; email: string; name: string } | null;
        }>;
      };

      expect(body.items).toHaveLength(3);

      // Item 1 is redeemed
      expect(body.items[0]?.serial).toBe(1);
      expect(body.items[0]?.status).toBe("redeemed");
      expect(body.items[0]?.codeMasked).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-••••-••••$/);
      expect(body.items[0]?.redeemedAt).not.toBeNull();
      expect(body.items[0]?.redeemedBy?.id).toBe(studentUser.id);
      expect(body.items[0]?.redeemedBy?.email).toBe(studentUser.email);

      // Item 2 is unredeemed
      expect(body.items[1]?.serial).toBe(2);
      expect(body.items[1]?.status).toBe("unredeemed");
      expect(body.items[1]?.codeMasked).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-••••-••••$/);
      expect(body.items[1]?.redeemedAt).toBeNull();
      expect(body.items[1]?.redeemedBy).toBeNull();

      // Assistant can also view (read-only)
      const asstCodes = await as(t, assistant.cookie, "GET", `/code-batches/${batchId}/codes`);
      expect(asstCodes.status).toBe(200);
    });

    it("filters codes by status=unredeemed / redeemed", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Filter Codes Course" },
      });

      const createRes = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 2,
      });
      const batchId = (createRes.body as { batch: { id: string } }).batch.id;

      // Redeem code 1
      await systemPrisma.accessCode.update({
        where: { tenantId_batchId_serialNumber: { tenantId: t.id, batchId, serialNumber: 1 } },
        data: { redeemedAt: new Date() },
      });

      // Filter unredeemed
      const unredeemedRes = await as(
        t,
        teacher.cookie,
        "GET",
        `/code-batches/${batchId}/codes?status=unredeemed`,
      );
      expect(unredeemedRes.status).toBe(200);
      const unredeemedItems = (unredeemedRes.body as { items: Array<{ serial: number }> }).items;
      expect(unredeemedItems.length).toBe(1);
      expect(unredeemedItems[0]?.serial).toBe(2);

      // Filter redeemed
      const redeemedRes = await as(
        t,
        teacher.cookie,
        "GET",
        `/code-batches/${batchId}/codes?status=redeemed`,
      );
      expect(redeemedRes.status).toBe(200);
      const redeemedItems = (redeemedRes.body as { items: Array<{ serial: number }> }).items;
      expect(redeemedItems.length).toBe(1);
      expect(redeemedItems[0]?.serial).toBe(1);
    });
  });

  describe("POST /api/code-batches/:id/revoke (Revocation Kill-Switch)", () => {
    it("revokes unredeemed codes only, preserves already-redeemed codes, writes audit log", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Revocation Course" },
      });

      const createRes = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 4,
      });
      const batchId = (createRes.body as { batch: { id: string } }).batch.id;

      // Simulate student redemption of code serial 1
      const studentUser = await fx.user();
      await systemPrisma.accessCode.update({
        where: { tenantId_batchId_serialNumber: { tenantId: t.id, batchId, serialNumber: 1 } },
        data: { redeemedAt: new Date(), redeemedBy: studentUser.id },
      });

      // Teacher revokes the batch
      const revokeRes = await as(t, teacher.cookie, "POST", `/code-batches/${batchId}/revoke`);
      expect(revokeRes.status).toBe(200);
      const revokeBody = revokeRes.body as {
        id: string;
        status: string;
        revokedCodesCount: number;
        preservedEnrollmentsCount: number;
        revokedAt: string;
      };

      expect(revokeBody.id).toBe(batchId);
      expect(revokeBody.status).toBe("revoked");
      expect(revokeBody.revokedCodesCount).toBe(3); // serials 2, 3, 4
      expect(revokeBody.preservedEnrollmentsCount).toBe(1); // serial 1 was already redeemed

      // Verify DB: serial 1 is NOT marked revoked (student keeps their entitlement)
      const code1 = await systemPrisma.accessCode.findUniqueOrThrow({
        where: { tenantId_batchId_serialNumber: { tenantId: t.id, batchId, serialNumber: 1 } },
      });
      expect(code1.revokedAt).toBeNull();
      expect(code1.redeemedAt).not.toBeNull();

      // Serials 2, 3, 4 ARE revoked
      const revokedCodes = await systemPrisma.accessCode.findMany({
        where: { batchId, serialNumber: { in: [2, 3, 4] } },
      });
      expect(revokedCodes.every((c) => c.revokedAt !== null)).toBe(true);

      // Batch is marked revoked in DB
      const dbBatch = await systemPrisma.accessCodeBatch.findUniqueOrThrow({
        where: { id: batchId },
      });
      expect(dbBatch.revokedAt).not.toBeNull();

      // Audit log
      const audits = await auditOf(t.id, batchId);
      const revokeAudit = audits.find((a) => a.action === "code_batch.revoke");
      expect(revokeAudit).toBeDefined();
      expect(revokeAudit?.actorUserId).toBe(teacher.user.id);
      expect(revokeAudit?.meta).toMatchObject({
        revokedCount: 3,
        preservedEnrollmentsCount: 1,
      });

      // Cannot revoke again -> 400
      const revokeAgain = await as(t, teacher.cookie, "POST", `/code-batches/${batchId}/revoke`);
      expect(revokeAgain.status).toBe(400);
      expect(reasonOf(revokeAgain.body)).toBe("BATCH_ALREADY_REVOKED");
    });

    it("assistants and students receive 403 on revocation", async () => {
      const t = await fx.tenant();
      const teacher = await fx.staffLogin(t, "teacher");
      const assistant = await fx.staffLogin(t, "assistant");
      const { user } = await fx.member(t.id, "student");
      const student = await fx.studentLogin(t, user.email);

      const course = await systemPrisma.course.create({
        data: { tenantId: t.id, title: "Course For Auth" },
      });
      const createRes = await as(t, teacher.cookie, "POST", "/code-batches", {
        courseId: course.id,
        count: 2,
      });
      const batchId = (createRes.body as { batch: { id: string } }).batch.id;

      // Assistant gets 403
      const asstRes = await as(t, assistant.cookie, "POST", `/code-batches/${batchId}/revoke`);
      expect(asstRes.status).toBe(403);

      // Student gets 403
      const studentRes = await as(t, student.cookies, "POST", `/code-batches/${batchId}/revoke`);
      expect(studentRes.status).toBe(403);
    });
  });

  describe("Multi-tenancy Isolation", () => {
    it("tenant A staff cannot view or revoke tenant B's code batches", async () => {
      const tenantA = await fx.tenant();
      const tenantB = await fx.tenant();

      const teacherA = await fx.staffLogin(tenantA, "teacher");
      const teacherB = await fx.staffLogin(tenantB, "teacher");

      const courseB = await systemPrisma.course.create({
        data: { tenantId: tenantB.id, title: "Tenant B Course" },
      });

      // Tenant B creates a batch
      const batchBRes = await as(tenantB, teacherB.cookie, "POST", "/code-batches", {
        courseId: courseB.id,
        count: 3,
      });
      const batchBId = (batchBRes.body as { batch: { id: string } }).batch.id;

      // Teacher A lists batches -> Tenant B's batch is not in list
      const listA = await as(tenantA, teacherA.cookie, "GET", "/code-batches");
      const itemsA = (listA.body as { items: Array<{ id: string }> }).items;
      expect(itemsA.some((item) => item.id === batchBId)).toBe(false);

      // Teacher A tries to view Tenant B's codes -> 404
      const codesA = await as(tenantA, teacherA.cookie, "GET", `/code-batches/${batchBId}/codes`);
      expect(codesA.status).toBe(404);

      // Teacher A tries to revoke Tenant B's batch -> 404
      const revokeA = await as(
        tenantA,
        teacherA.cookie,
        "POST",
        `/code-batches/${batchBId}/revoke`,
      );
      expect(revokeA.status).toBe(404);
    });
  });
});
