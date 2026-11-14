import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { auth, getLastSentEmail } from "@itqan/auth";
import { runWithContext, systemPrisma } from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createHttpTestApp } from "../testing/http.js";
import { NotificationsService } from "./notifications.service.js";
import { StudentsAccessService } from "../students/students-access.service.js";

let httpTestApp: Awaited<ReturnType<typeof createHttpTestApp>>;
let tenantSlug: string;
let tenantHost: string;
let tenantId: string;
let notificationsService: NotificationsService;
let studentsAccessService: StudentsAccessService;

const createdUserIds: string[] = [];

function toCookieHeader(headers: Headers): string {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") || ""];

  return setCookies
    .map((header) => header.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function createAuthenticatedStudent(opts: {
  name: string;
}): Promise<{ userId: string; email: string; cookie: string; deviceId: string }> {
  const email = `sse-student-${randomUUID().slice(0, 8)}@example.com`;
  const password = "StrongPassword123!";

  const signUp = await auth.api.signUpEmail({
    body: { email, password, name: opts.name },
  });
  createdUserIds.push(signUp.user.id);

  const verificationEmail = getLastSentEmail(email);
  if (verificationEmail) {
    const url = new URL(verificationEmail.url);
    const token = url.searchParams.get("token");
    if (token) {
      await auth.api.verifyEmail({ query: { token } });
    }
  }

  await systemPrisma.membership.create({
    data: { tenantId, userId: signUp.user.id, role: "student" },
  });

  const signIn = await auth.api.signInStudent({
    body: { email, password },
    headers: new Headers({ host: tenantHost }),
    returnHeaders: true,
  });

  const cookie = toCookieHeader(signIn.headers);

  // Retrieve deviceId associated with the student's active device
  const device = await systemPrisma.device.findFirstOrThrow({
    where: { userId: signUp.user.id, status: "active" },
    select: { id: true },
  });

  return { userId: signUp.user.id, email, cookie, deviceId: device.id };
}

async function createAuthenticatedTeacher(opts: {
  name: string;
}): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `sse-teacher-${randomUUID().slice(0, 8)}@example.com`;
  const password = "StrongPassword123!";

  const signUp = await auth.api.signUpEmail({
    body: { email, password, name: opts.name },
  });
  createdUserIds.push(signUp.user.id);

  const verificationEmail = getLastSentEmail(email);
  if (verificationEmail) {
    const url = new URL(verificationEmail.url);
    const token = url.searchParams.get("token");
    if (token) {
      await auth.api.verifyEmail({ query: { token } });
    }
  }

  await systemPrisma.membership.create({
    data: { tenantId, userId: signUp.user.id, role: "teacher" },
  });

  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });

  const cookie = toCookieHeader(signIn.headers);
  return { userId: signUp.user.id, email, cookie };
}

function connectSse(
  server: http.Server,
  host: string,
  path: string,
  cookie: string,
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  waitForEvent: (eventName: string, timeoutMs?: number) => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as AddressInfo;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
        headers: {
          host,
          cookie,
          accept: "text/event-stream",
        },
      },
      (res) => {
        let buffer = "";
        const waiters: Array<{ eventName: string; resolve: (data: string) => void }> = [];

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          for (let i = waiters.length - 1; i >= 0; i--) {
            const w = waiters[i];
            if (w && buffer.includes(`event: ${w.eventName}`)) {
              waiters.splice(i, 1);
              w.resolve(buffer);
            }
          }
        });

        const waitForEvent = (eventName: string, timeoutMs = 5000): Promise<string> => {
          if (buffer.includes(`event: ${eventName}`)) {
            return Promise.resolve(buffer);
          }
          return new Promise((resWait, rejWait) => {
            const timer = setTimeout(() => {
              rejWait(new Error(`Timeout waiting for event "${eventName}". Buffer: ${buffer}`));
            }, timeoutMs);

            waiters.push({
              eventName,
              resolve: (data) => {
                clearTimeout(timer);
                resWait(data);
              },
            });
          });
        };

        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          waitForEvent,
          close: () => {
            req.destroy();
            res.destroy();
          },
        });
      },
    );

    req.on("error", reject);
    req.end();
  });
}

describe("SSE Real-Time Stream (FR-N02, Step 9.2)", () => {
  beforeAll(async () => {
    httpTestApp = await createHttpTestApp(AppModule);
    notificationsService = httpTestApp.app.get(NotificationsService);
    studentsAccessService = httpTestApp.app.get(StudentsAccessService);

    tenantSlug = `sse-t-${randomUUID().slice(0, 8)}`;
    tenantHost = `${tenantSlug}.localhost`;

    const tenant = await systemPrisma.tenant.create({
      data: { name: `SSE Tenant ${tenantSlug}`, slug: tenantSlug },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await httpTestApp.close();

    if (tenantId) {
      await systemPrisma.tenant.delete({ where: { id: tenantId } });
    }

    if (createdUserIds.length > 0) {
      await systemPrisma.notification.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.session.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.membership.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.device.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.account.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await systemPrisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
  });

  it("returns protocol headers and initial connected event", async () => {
    const student = await createAuthenticatedStudent({ name: "Header Student" });
    const sse = await connectSse(
      httpTestApp.app.getHttpServer(),
      tenantHost,
      "/api/sse",
      student.cookie,
    );

    try {
      expect(sse.statusCode).toBe(200);
      expect(sse.headers["content-type"]).toBe("text/event-stream");
      expect(sse.headers["cache-control"]).toBe("no-cache, no-transform");
      expect(sse.headers["connection"]).toBe("keep-alive");
      expect(sse.headers["x-accel-buffering"]).toBe("no");

      const event = await sse.waitForEvent("connected");
      expect(event).toContain("event: connected");
      expect(event).toContain("connectedAt");
    } finally {
      sse.close();
    }
  });

  it("pushes notification.created event in real time", async () => {
    const student = await createAuthenticatedStudent({ name: "Notif Student" });
    const sse = await connectSse(
      httpTestApp.app.getHttpServer(),
      tenantHost,
      "/api/sse",
      student.cookie,
    );

    try {
      await sse.waitForEvent("connected");

      const uniqueTitle = `Live Announcement ${randomUUID().slice(0, 6)}`;
      await runWithContext(
        { kind: "tenant", tenantId, tenantSlug, ip: "127.0.0.1", userAgent: "test" },
        () =>
          notificationsService.create({
            tenantId,
            userId: student.userId,
            type: "announcement",
            title: uniqueTitle,
            body: "Check the bulletin",
          }),
      );

      const chunk = await sse.waitForEvent("notification.created");
      expect(chunk).toContain("event: notification.created");
      expect(chunk).toContain(uniqueTitle);
    } finally {
      sse.close();
    }
  });

  it("pushes device_revoked control event when staff revokes a device", async () => {
    const student = await createAuthenticatedStudent({ name: "Revoke Student" });
    const teacher = await createAuthenticatedTeacher({ name: "Revoke Teacher" });

    const sse = await connectSse(
      httpTestApp.app.getHttpServer(),
      tenantHost,
      "/api/sse",
      student.cookie,
    );

    try {
      await sse.waitForEvent("connected");

      // Teacher revokes the student's active device via POST /api/devices/:id/revoke
      const revokeRes = await httpTestApp.send(
        tenantHost,
        "POST",
        `/api/devices/${student.deviceId}/revoke`,
        undefined,
        { cookie: teacher.cookie },
      );
      expect(revokeRes.status).toBe(200);

      const chunk = await sse.waitForEvent("device_revoked");
      expect(chunk).toContain("event: device_revoked");
      expect(chunk).toContain(student.deviceId);
    } finally {
      sse.close();
    }
  });

  it("supports /api/notifications/stream as an endpoint alias", async () => {
    const student = await createAuthenticatedStudent({ name: "Alias Student" });
    const sse = await connectSse(
      httpTestApp.app.getHttpServer(),
      tenantHost,
      "/api/notifications/stream",
      student.cookie,
    );

    try {
      expect(sse.statusCode).toBe(200);
      expect(sse.headers["content-type"]).toBe("text/event-stream");
      const event = await sse.waitForEvent("connected");
      expect(event).toContain("event: connected");
    } finally {
      sse.close();
    }
  });
});
