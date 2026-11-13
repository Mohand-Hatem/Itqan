import { randomUUID } from "node:crypto";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { studentFixtures } from "../testing/students.js";

const PASSWORD = "CheckpointPassword123!";
const fx = studentFixtures(PASSWORD);
let http: Awaited<ReturnType<typeof createHttpTestApp>>;

beforeAll(async () => {
  http = await createHttpTestApp(AppModule);
});

afterAll(async () => {
  await http?.close();
  await systemPrisma.auditLog.deleteMany({
    where: {
      action: {
        in: [
          "invitation.create",
          "invitation.redeem",
          "code_batch.create",
          "code.redeem",
          "enrollment.grant",
          "enrollment.terminate",
          "assistant.create",
          "assistant.delete",
          "tenant.create",
          "tenant.update",
          "tenant.delete",
        ],
      },
    },
  });
  await systemPrisma.tenant.deleteMany({
    where: { slug: { startsWith: "chk6-" } },
  });
  await fx.cleanup();
  await systemPrisma.$disconnect();
});

describe("API Checkpoint 6: End-to-End People & Access Lifecycle", () => {
  it("verifies: student joins by invitation or code, logs in on one device, accesses content, and is removed through the API", async () => {
    // -------------------------------------------------------------
    // 1. Academy & Course Setup
    // -------------------------------------------------------------
    const slug = `chk6-${randomUUID().slice(0, 6)}`;
    const tenant = await systemPrisma.tenant.create({
      data: {
        name: "Checkpoint 6 Academy",
        slug,
        status: "active",
      },
    });

    const teacher = await fx.staffLogin(tenant, "teacher");
    const assistant = await fx.staffLogin(tenant, "assistant");

    // Teacher creates two courses
    const course1 = await systemPrisma.course.create({
      data: {
        tenantId: tenant.id,
        title: "Calculus I",
        status: "published",
      },
    });
    const course2 = await systemPrisma.course.create({
      data: {
        tenantId: tenant.id,
        title: "Linear Algebra",
        status: "published",
      },
    });

    // -------------------------------------------------------------
    // 2. Student A joins by Invitation (FR-E01, FR-A06)
    // -------------------------------------------------------------
    const studentAEmail = `student-a-${randomUUID().slice(0, 8)}@example.com`;

    // Teacher issues invitation for course1
    const invRes = await http.send(
      `${slug}.localhost`,
      "POST",
      "/api/invitations",
      {
        email: studentAEmail,
        courseIds: [course1.id],
      },
      { cookie: teacher.cookie },
    );
    expect(invRes.status).toBe(201);
    const token = (invRes.body as { token: string }).token;

    // Student A registers via invitation with guardian consent
    const regRes = await http.send(`${slug}.localhost`, "POST", "/api/register", {
      token,
      name: "Student Alpha",
      password: PASSWORD,
      guardianName: "Parent Alpha",
      guardianPhone: "+201000000001",
      guardianRelationship: "father",
    });
    expect(regRes.status).toBe(201);

    // Student A logs in on Device 1
    const studentALogin = await fx.studentLogin(tenant, studentAEmail);
    expect(studentALogin.status).toBe(200);

    // Student A accesses course 1 content -> 200 { access: true }
    const accessC1 = await http.send(
      `${slug}.localhost`,
      "GET",
      `/api/courses/${course1.id}/access`,
      undefined,
      { cookie: studentALogin.cookies },
    );
    expect(accessC1.status).toBe(200);
    expect((accessC1.body as { access: boolean }).access).toBe(true);

    // Student A attempts to access course 2 -> 403 ENROLLMENT_REQUIRED
    const accessC2 = await http.send(
      `${slug}.localhost`,
      "GET",
      `/api/courses/${course2.id}/access`,
      undefined,
      { cookie: studentALogin.cookies },
    );
    expect(accessC2.status).toBe(403);

    // -------------------------------------------------------------
    // 3. Student B joins by Access Code (FR-E02)
    // -------------------------------------------------------------
    const studentBEmail = `student-b-${randomUUID().slice(0, 8)}@example.com`;

    // Teacher mints access code batch for course2
    const batchRes = await http.send(
      `${slug}.localhost`,
      "POST",
      "/api/code-batches",
      {
        name: "Fall Promo Batch",
        courseId: course2.id,
        count: 5,
      },
      { cookie: teacher.cookie },
    );
    expect(batchRes.status).toBe(201);
    const csv = (batchRes.body as { csv: string }).csv;
    const codes = csv
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[1]?.trim())
      .filter(Boolean);
    const codeForB = codes[0];
    const _codeForAdditional = codes[1];

    // Student B registers with code
    const regCodeRes = await http.send(`${slug}.localhost`, "POST", "/api/register-with-code", {
      code: codeForB,
      name: "Student Beta",
      email: studentBEmail,
      password: PASSWORD,
      phone: "+201100000002",
      isMinor: true,
      guardianConsent: true,
    });
    expect(regCodeRes.status).toBe(201);

    // Registration with code marks emailVerified: false until verified; mark verified for test sign-in
    await systemPrisma.user.update({
      where: { email: studentBEmail },
      data: { emailVerified: true },
    });

    // Student B signs in on Device 2
    const studentBLogin = await fx.studentLogin(tenant, studentBEmail);
    expect(studentBLogin.status).toBe(200);

    // Student B accesses course 2
    const bAccessC2 = await http.send(
      `${slug}.localhost`,
      "GET",
      `/api/courses/${course2.id}/access`,
      undefined,
      { cookie: studentBLogin.cookies },
    );
    expect(bAccessC2.status).toBe(200);

    // Student B redeems an additional code into account
    // (First let's mint a code for course1 so student B can enroll in course1 too)
    const batchResCourse1 = await http.send(
      `${slug}.localhost`,
      "POST",
      "/api/code-batches",
      {
        name: "Course 1 Addon Batch",
        courseId: course1.id,
        count: 2,
      },
      { cookie: teacher.cookie },
    );
    const csvC1 = (batchResCourse1.body as { csv: string }).csv;
    const codeForC1 = csvC1
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[1]?.trim())
      .filter(Boolean)[0];

    const redeemRes = await http.send(
      `${slug}.localhost`,
      "POST",
      "/api/codes/redeem",
      { code: codeForC1 },
      { cookie: studentBLogin.cookies },
    );
    expect(redeemRes.status).toBe(200);

    // Student B can now access course 1 as well
    const bAccessC1 = await http.send(
      `${slug}.localhost`,
      "GET",
      `/api/courses/${course1.id}/access`,
      undefined,
      { cookie: studentBLogin.cookies },
    );
    expect(bAccessC1.status).toBe(200);

    // -------------------------------------------------------------
    // 4. One Device Rule Enforcement
    // -------------------------------------------------------------
    // Student A tries to log in from a second browser without device cookie -> blocked
    const studentASecondLogin = await fx.studentLogin(tenant, studentAEmail);
    expect(studentASecondLogin.status).toBe(403);

    // -------------------------------------------------------------
    // 5. Student Removal: Enrollment Termination (FR-E05)
    // -------------------------------------------------------------
    const studentAMembership = await systemPrisma.membership.findFirstOrThrow({
      where: { tenantId: tenant.id, user: { email: studentAEmail } },
    });
    const studentAEnrollment = await systemPrisma.enrollment.findFirstOrThrow({
      where: { tenantId: tenant.id, membershipId: studentAMembership.id, courseId: course1.id },
    });

    // Assistant is forbidden from terminating enrollments
    const asstDel = await http.send(
      `${slug}.localhost`,
      "DELETE",
      `/api/enrollments/${studentAEnrollment.id}`,
      undefined,
      { cookie: assistant.cookie },
    );
    expect(asstDel.status).toBe(403);

    // Teacher terminates Student A's enrollment
    const teacherDel = await http.send(
      `${slug}.localhost`,
      "DELETE",
      `/api/enrollments/${studentAEnrollment.id}`,
      undefined,
      { cookie: teacher.cookie },
    );
    expect(teacherDel.status).toBe(200);

    // Student A is now immediately denied content access with 403 ENROLLMENT_TERMINATED
    const terminatedAccess = await http.send(
      `${slug}.localhost`,
      "GET",
      `/api/courses/${course1.id}/access`,
      undefined,
      { cookie: studentALogin.cookies },
    );
    expect(terminatedAccess.status).toBe(403);
    expect((terminatedAccess.body as { reason?: string })?.reason).toBe("ENROLLMENT_TERMINATED");
  });
});
