import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { TENANT_MODELS } from "../tenant-extension.js";

type MakeRow = (db: PrismaClient, tenantId: string) => Promise<{ id: string }>;

// One "make a row" function per tenant-owned model. Adding a tenant table means adding
// an entry here; isolation.int.spec.ts fails until you do, then sweeps the new table.
export const TENANT_FIXTURES: Record<string, MakeRow> = {
  Membership: async (db, tenantId) => {
    const user = await db.user.create({
      data: {
        email: `fixture-${randomUUID()}@example.com`,
        name: "Fixture Student",
      },
    });
    return db.membership.create({ data: { tenantId, userId: user.id, role: "student" } });
  },
  AuditLog: (db, tenantId) => db.auditLog.create({ data: { tenantId, action: "test.fixture" } }),
  SupportRequest: async (db, tenantId) => {
    const user = await db.user.create({
      data: { email: `fixture-${randomUUID()}@example.com`, name: "Fixture Requester" },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, role: "student" },
    });
    return db.supportRequest.create({
      data: { tenantId, membershipId: membership.id, type: "general" },
    });
  },
  Course: (db, tenantId) =>
    db.course.create({
      data: {
        tenantId,
        title: "Fixture Course",
        description: "Fixture Description",
      },
    }),
  Invitation: async (db, tenantId) => {
    const creator = await db.user.create({
      data: { email: `fixture-creator-${randomUUID()}@example.com`, name: "Fixture Creator" },
    });
    return db.invitation.create({
      data: {
        tenantId,
        email: `invited-${randomUUID()}@example.com`,
        tokenHash: randomUUID(),
        courseIds: [],
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        createdBy: creator.id,
      },
    });
  },
  Enrollment: async (db, tenantId) => {
    const user = await db.user.create({
      data: { email: `fixture-enrolled-${randomUUID()}@example.com`, name: "Fixture Enrolled" },
    });
    const granter = await db.user.create({
      data: { email: `fixture-granter-${randomUUID()}@example.com`, name: "Fixture Granter" },
    });
    const membership = await db.membership.create({
      data: { tenantId, userId: user.id, role: "student" },
    });
    const course = await db.course.create({
      data: { tenantId, title: "Fixture Enrollment Course" },
    });
    return db.enrollment.create({
      data: {
        tenantId,
        membershipId: membership.id,
        courseId: course.id,
        status: "active",
        source: "invitation",
        grantedBy: granter.id,
      },
    });
  },
  AccessCodeBatch: async (db, tenantId) => {
    const creator = await db.user.create({
      data: { email: `fixture-batch-creator-${randomUUID()}@example.com`, name: "Batch Creator" },
    });
    const course = await db.course.create({
      data: { tenantId, title: "Fixture Batch Course" },
    });
    return db.accessCodeBatch.create({
      data: {
        tenantId,
        courseId: course.id,
        name: "Fixture Batch",
        codeCount: 10,
        createdById: creator.id,
      },
    });
  },
  AccessCode: async (db, tenantId) => {
    const creator = await db.user.create({
      data: { email: `fixture-code-creator-${randomUUID()}@example.com`, name: "Code Creator" },
    });
    const course = await db.course.create({
      data: { tenantId, title: "Fixture Code Course" },
    });
    const batch = await db.accessCodeBatch.create({
      data: {
        tenantId,
        courseId: course.id,
        name: "Parent Batch",
        codeCount: 1,
        createdById: creator.id,
      },
    });
    return db.accessCode.create({
      data: {
        tenantId,
        batchId: batch.id,
        courseId: course.id,
        serialNumber: 1,
        codeHash: randomUUID(),
        codePrefix: "TEST",
      },
    });
  },
};

export type FixtureTenant = {
  id: string;
  slug: string;
  /** Model name → id of this tenant's fixture row. */
  rows: Record<string, string>;
};

async function createFixtureTenant(db: PrismaClient, label: string): Promise<FixtureTenant> {
  const slug = `t-${label}-${randomUUID().slice(0, 8)}`;
  const tenant = await db.tenant.create({ data: { slug, name: `Tenant ${label}` } });
  const rows: Record<string, string> = {};
  for (const model of TENANT_MODELS) {
    const make = TENANT_FIXTURES[model];
    if (!make) throw new Error(`No isolation fixture for ${model}. Add one to TENANT_FIXTURES.`);
    rows[model] = (await make(db, tenant.id)).id;
  }
  return { id: tenant.id, slug: tenant.slug, rows };
}

// Two tenants with one row in every tenant-owned table. Pass the raw (unscoped) test client.
export async function createTwoTenants(db: PrismaClient) {
  const a = await createFixtureTenant(db, "a");
  const b = await createFixtureTenant(db, "b");
  return {
    a,
    b,
    // Deleting the tenants cascades to all their rows.
    cleanup: () => db.tenant.deleteMany({ where: { id: { in: [a.id, b.id] } } }),
  };
}
