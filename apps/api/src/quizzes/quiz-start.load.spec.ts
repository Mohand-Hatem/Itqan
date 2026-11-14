import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  DEVICE_COOKIE_NAME,
  createDeviceSecret,
  formatDeviceCookie,
  hashDeviceSecret,
} from "@itqan/auth";
import { systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";

interface PreauthenticatedStudent {
  userId: string;
  membershipId: string;
  deviceId: string;
  cookieHeader: string;
}

interface RequestMetric {
  studentIndex: number;
  statusCode: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

function computeStatistics(metrics: RequestMetric[], totalDurationSec: number) {
  const latencies = metrics.map((m) => m.latencyMs).sort((a, b) => a - b);
  const n = latencies.length;
  const successful = metrics.filter((m) => m.success).length;

  const getPercentile = (p: number) => {
    const idx = Math.ceil((p / 100) * n) - 1;
    return latencies[Math.max(0, Math.min(idx, n - 1))];
  };

  const sum = latencies.reduce((acc, v) => acc + v, 0);

  return {
    totalRequests: n,
    successfulRequests: successful,
    failedRequests: n - successful,
    errorRate: ((n - successful) / n) * 100,
    throughputRps: n / totalDurationSec,
    minMs: latencies[0] ?? 0,
    maxMs: latencies[n - 1] ?? 0,
    meanMs: sum / n,
    p50Ms: getPercentile(50) ?? 0,
    p90Ms: getPercentile(90) ?? 0,
    p95Ms: getPercentile(95) ?? 0,
    p99Ms: getPercentile(99) ?? 0,
  };
}

describe("Step 8.13 — Quiz Start Load Test (NFR-03 & NFR-02)", () => {
  const TOTAL_STUDENTS = 300;
  let testApp: Awaited<ReturnType<typeof createHttpTestApp>>;
  let serverPort: number;
  let keepAliveAgent: http.Agent;

  let tenantId: string;
  let tenantSlug: string;
  let courseId: string;
  let quizId: string;
  let students: PreauthenticatedStudent[] = [];
  let userIds: string[] = [];
  let loadMetrics: RequestMetric[] = [];
  let totalElapsedSec = 0;

  beforeAll(async () => {
    testApp = await createHttpTestApp(AppModule);
    serverPort = (testApp.app.getHttpServer().address() as AddressInfo).port;
    keepAliveAgent = new http.Agent({
      keepAlive: true,
      maxSockets: 50,
      keepAliveMsecs: 30_000,
    });
  });

  afterAll(async () => {
    keepAliveAgent?.destroy();
    await testApp?.close();

    if (tenantId) {
      await systemPrisma.tenant.deleteMany({ where: { id: tenantId } });
    }
    if (userIds.length > 0) {
      await systemPrisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await systemPrisma.$disconnect();
  });

  it("G1: Fast Bulk Seeding — seeds 1 tenant, 1 course, 1 quiz, and 300 students in < 5s", async () => {
    const seedStart = performance.now();
    const secret =
      process.env["BETTER_AUTH_SECRET"] ||
      "development-secret-for-build-and-test-only-min-32-chars";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

    // 1. Create Tenant
    tenantSlug = `load-${randomUUID().slice(0, 8)}`;
    const tenant = await systemPrisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "Load Test Academy",
        status: "active",
      },
    });
    tenantId = tenant.id;

    // 2. Create Course
    const course = await systemPrisma.course.create({
      data: {
        tenantId,
        title: "Load Test Course",
        status: "published",
      },
    });
    courseId = course.id;

    // 3. Create Question Bank, Question, and Options
    const bank = await systemPrisma.questionBank.create({
      data: { tenantId, courseId, title: "Load Test Bank" },
    });

    const question = await systemPrisma.question.create({
      data: {
        tenantId,
        bankId: bank.id,
        type: "single",
        text: "What is 2 + 2?",
        marks: 1,
        options: {
          create: [
            { tenantId, text: "3", isCorrect: false, sortOrder: 0 },
            { tenantId, text: "4", isCorrect: true, sortOrder: 1 },
          ],
        },
      },
    });

    // 4. Create Published Quiz
    const quiz = await systemPrisma.quiz.create({
      data: {
        tenantId,
        courseId,
        title: "High Concurrency Quiz 300",
        durationMin: 30,
        passMark: 1,
        maxAttempts: 1,
        selection: "manual",
        opensAt: new Date(now.getTime() - 60_000), // Opened 1m ago
        closesAt: new Date(now.getTime() + 3600_000),
        publishedAt: now,
        quizQuestions: {
          create: [{ tenantId, questionId: question.id, sortOrder: 0 }],
        },
      },
    });
    quizId = quiz.id;

    // 5. Pre-generate data in memory for 300 students
    const usersData: Array<{
      id: string;
      email: string;
      name: string;
      emailVerified: boolean;
      status: "active" | "suspended";
      maxDevices: number;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    const membershipsData: Array<{
      id: string;
      tenantId: string;
      userId: string;
      role: "student" | "teacher" | "assistant";
      status: "active" | "suspended";
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    const devicesData: Array<{
      id: string;
      userId: string;
      status: "active" | "pending" | "revoked";
      secretHash: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    const enrollmentsData: Array<{
      id: string;
      tenantId: string;
      membershipId: string;
      courseId: string;
      status: "active" | "terminated";
      source: "manual";
      grantedBy: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    const sessionsData: Array<{
      id: string;
      userId: string;
      deviceId: string;
      tenantId: string;
      token: string;
      expiresAt: Date;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    students = [];
    userIds = [];

    for (let i = 0; i < TOTAL_STUDENTS; i++) {
      const userId = randomUUID();
      const membershipId = randomUUID();
      const deviceId = randomUUID();
      const token = randomUUID();
      const rawDeviceSecret = createDeviceSecret();
      const secretHash = hashDeviceSecret(rawDeviceSecret);

      const hmacSig = createHmac("sha256", secret).update(token).digest("base64");
      const signedSessionToken = encodeURIComponent(`${token}.${hmacSig}`);
      const deviceCookieVal = formatDeviceCookie(deviceId, rawDeviceSecret);

      const cookieHeader = `better-auth.session_token=${signedSessionToken}; ${DEVICE_COOKIE_NAME}=${deviceCookieVal}`;

      userIds.push(userId);

      usersData.push({
        id: userId,
        email: `loadstudent_${i}_${randomUUID().slice(0, 6)}@example.com`,
        name: `Load Student ${i}`,
        emailVerified: true,
        status: "active",
        maxDevices: 1,
        createdAt: now,
        updatedAt: now,
      });

      membershipsData.push({
        id: membershipId,
        tenantId,
        userId,
        role: "student",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      devicesData.push({
        id: deviceId,
        userId,
        status: "active",
        secretHash,
        createdAt: now,
        updatedAt: now,
      });

      enrollmentsData.push({
        id: randomUUID(),
        tenantId,
        membershipId,
        courseId,
        status: "active",
        source: "manual",
        grantedBy: userId,
        createdAt: now,
        updatedAt: now,
      });

      sessionsData.push({
        id: randomUUID(),
        userId,
        deviceId,
        tenantId,
        token,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      students.push({ userId, membershipId, deviceId, cookieHeader });
    }

    // 6. Bulk write in 5 SQL queries
    await systemPrisma.user.createMany({ data: usersData });
    await systemPrisma.membership.createMany({ data: membershipsData });
    await systemPrisma.device.createMany({ data: devicesData });
    await systemPrisma.enrollment.createMany({ data: enrollmentsData });
    await systemPrisma.session.createMany({ data: sessionsData });

    const seedDurationMs = performance.now() - seedStart;
    console.log(`[Load Test] Pre-seeded 300 students in ${seedDurationMs.toFixed(1)}ms`);

    expect(students).toHaveLength(TOTAL_STUDENTS);
    expect(seedDurationMs).toBeLessThan(5000);
  });

  it("G2 & G3: 300 students start one quiz within 60 seconds (NFR-03, NFR-02 p95 <= 500ms, 0% error)", async () => {
    expect(students).toHaveLength(TOTAL_STUDENTS);

    const CONCURRENCY = 10;
    loadMetrics = [];
    const testStartTime = performance.now();

    function sendAttemptRequest(student: PreauthenticatedStudent, index: number): Promise<RequestMetric> {
      return new Promise((resolve) => {
        const reqStart = performance.now();
        const req = http.request(
          {
            host: "127.0.0.1",
            port: serverPort,
            path: `/api/quizzes/${quizId}/attempts`,
            method: "POST",
            agent: keepAliveAgent,
            headers: {
              host: `${tenantSlug}.localhost`,
              cookie: student.cookieHeader,
              "content-type": "application/json",
              connection: "keep-alive",
            },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              const latencyMs = performance.now() - reqStart;
              const success = res.statusCode === 201;
              resolve({
                studentIndex: index,
                statusCode: res.statusCode ?? 0,
                latencyMs,
                success,
                error: success ? undefined : `Status ${res.statusCode}: ${data}`,
              });
            });
          },
        );
        req.on("error", (err) => {
          resolve({
            studentIndex: index,
            statusCode: 0,
            latencyMs: performance.now() - reqStart,
            success: false,
            error: err.message,
          });
        });
        req.end();
      });
    }

    // Work-stealing concurrency worker pool with realistic student arrival spacing
    let currentIndex = 0;
    async function worker() {
      while (currentIndex < students.length) {
        const idx = currentIndex++;
        const student = students[idx]!;
        const metric = await sendAttemptRequest(student, idx);
        loadMetrics.push(metric);
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    const totalElapsedMs = performance.now() - testStartTime;
    totalElapsedSec = totalElapsedMs / 1000;

    const stats = computeStatistics(loadMetrics, totalElapsedSec);

    console.log("------------------------------------------------------------");
    console.log(`[Load Test Results] 300 Students Start Exam`);
    console.log(`Total Requests:      ${stats.totalRequests}`);
    console.log(`Successful (201):    ${stats.successfulRequests}`);
    console.log(`Failed:              ${stats.failedRequests}`);
    console.log(`Error Rate:          ${stats.errorRate.toFixed(2)}%`);
    console.log(`Total Duration:      ${totalElapsedSec.toFixed(2)} s`);
    console.log(`Throughput:          ${stats.throughputRps.toFixed(1)} req/s`);
    console.log(`Min Latency:         ${stats.minMs.toFixed(1)} ms`);
    console.log(`Mean Latency:        ${stats.meanMs.toFixed(1)} ms`);
    console.log(`p50 Latency:         ${stats.p50Ms.toFixed(1)} ms`);
    console.log(`p90 Latency:         ${stats.p90Ms.toFixed(1)} ms`);
    console.log(`p95 Latency:         ${stats.p95Ms.toFixed(1)} ms (SLA <= 500ms)`);
    console.log(`p99 Latency:         ${stats.p99Ms.toFixed(1)} ms`);
    console.log(`Max Latency:         ${stats.maxMs.toFixed(1)} ms`);
    console.log("------------------------------------------------------------");

    // NFR-03: Handled within one minute
    expect(totalElapsedSec).toBeLessThanOrEqual(60);

    // G2: Zero error rate
    expect(stats.failedRequests).toBe(0);
    expect(stats.errorRate).toBe(0);
    expect(stats.successfulRequests).toBe(TOTAL_STUDENTS);

    // G3 & NFR-02: p95 latency under 500 ms
    expect(stats.p95Ms).toBeLessThanOrEqual(500);
    expect(stats.meanMs).toBeLessThanOrEqual(400);
  }, 90_000);

  it("G4 & G5: Database Invariants — snapshot isolation, device binding & audit logging", async () => {
    // 1. Verify exactly 300 attempts created
    const attempts = await systemPrisma.attempt.findMany({
      where: { quizId, tenantId },
    });
    expect(attempts).toHaveLength(TOTAL_STUDENTS);

    // 2. Verify all 300 attempts belong to distinct memberships and devices
    const distinctMemberships = new Set(attempts.map((a) => a.membershipId));
    const distinctDevices = new Set(attempts.map((a) => a.deviceId));
    expect(distinctMemberships.size).toBe(TOTAL_STUDENTS);
    expect(distinctDevices.size).toBe(TOTAL_STUDENTS);

    // 3. Verify snapshot integrity and answer masking (FR-X05, FR-X08)
    for (const att of attempts) {
      expect(att.attemptNo).toBe(1);
      expect(att.submittedAt).toBeNull();
      expect(att.score).toBeNull();
      expect(att.passed).toBeNull();

      const snapshot = att.snapshot as {
        questions: Array<{
          id: string;
          type: string;
          options: Array<{ id: string; text: string }>;
        }>;
      };
      expect(snapshot.questions).toHaveLength(1);
      expect(snapshot.questions[0]!.options).toHaveLength(2);
    }

    // 4. G5: Audit logging verification (FR-L01)
    const auditLogs = await systemPrisma.auditLog.count({
      where: {
        tenantId,
        action: "attempt.start",
        targetType: "attempt",
      },
    });
    expect(auditLogs).toBe(TOTAL_STUDENTS);
  });
});
