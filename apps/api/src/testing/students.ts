// Test data for student device and support-request tests: tenants, users with a password,
// memberships and devices, plus one cleanup call. Test-only; never imported by app code.
import { randomUUID } from "node:crypto";
import {
  DEVICE_COOKIE_NAME,
  auth,
  createDeviceSecret,
  formatDeviceCookie,
  hashDeviceSecret,
} from "@itqan/auth";
import { type Role, systemPrisma } from "@itqan/database";
import type { APIError } from "better-auth/api";

const cookiesOf = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .join("; ");

export function studentFixtures(password: string) {
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  async function tenant(pausedRoles: Role[] = []) {
    const row = await systemPrisma.tenant.create({
      data: { slug: `st-${randomUUID().slice(0, 8)}`, name: "Student Test Tenant", pausedRoles },
    });
    tenantIds.push(row.id);
    return row;
  }

  async function user(opts: { suspended?: boolean; maxDevices?: number } = {}) {
    const ctx = await auth.$context;
    const row = await systemPrisma.user.create({
      data: {
        email: `st-${randomUUID().slice(0, 8)}@example.com`,
        name: "Student Test",
        emailVerified: true,
        status: opts.suspended ? "suspended" : "active",
        maxDevices: opts.maxDevices ?? 1,
      },
    });
    await systemPrisma.account.create({
      data: {
        userId: row.id,
        accountId: row.id,
        providerId: "credential",
        password: await ctx.password.hash(password),
      },
    });
    userIds.push(row.id);
    return row;
  }

  async function member(
    tenantId: string,
    role: Role = "student",
    opts: Parameters<typeof user>[0] = {},
  ) {
    const u = await user(opts);
    const membership = await systemPrisma.membership.create({
      data: { userId: u.id, tenantId, role },
    });
    return { user: u, membership };
  }

  /** A device already bound to the account, with the Cookie header that presents it. */
  async function device(userId: string, status: "active" | "pending" = "active") {
    const secret = createDeviceSecret();
    const row = await systemPrisma.device.create({
      data: { userId, status, secretHash: hashDeviceSecret(secret) },
    });
    return { device: row, cookie: `${DEVICE_COOKIE_NAME}=${formatDeviceCookie(row.id, secret)}` };
  }

  /** An open session on a device, as if the student were signed in there. */
  function session(userId: string, deviceId: string, tenantId: string, expiresInMs = 3_600_000) {
    return systemPrisma.session.create({
      data: {
        userId,
        deviceId,
        tenantId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + expiresInMs),
      },
    });
  }

  /** A browser signing in through /sign-in/student: { status, code, cookies } (session + device). */
  async function studentLogin(t: { slug: string }, email: string, deviceCookie?: string) {
    const headers = new Headers({ host: `${t.slug}.localhost` });
    if (deviceCookie) headers.set("cookie", deviceCookie);
    try {
      const res = await auth.api.signInStudent({
        body: { email, password },
        headers,
        returnHeaders: true,
      });
      return {
        status: 200,
        code: undefined as string | undefined,
        cookies: cookiesOf(res.headers),
      };
    } catch (e) {
      const err = e as APIError;
      return { status: err.statusCode, code: (err.body as { code?: string })?.code, cookies: "" };
    }
  }

  /** A staff member of the tenant signed in through the stock sign-in. */
  async function staffLogin(
    t: { id: string },
    role: "teacher" | "assistant" = "teacher",
    opts: { superAdmin?: boolean } = {},
  ) {
    const u = opts.superAdmin ? await user() : (await member(t.id, role)).user;
    if (opts.superAdmin)
      await systemPrisma.user.update({ where: { id: u.id }, data: { isSuperAdmin: true } });
    const res = await auth.api.signInEmail({
      body: { email: u.email, password },
      returnHeaders: true,
    });
    return { user: u, cookie: cookiesOf(res.headers) };
  }

  async function cleanup() {
    // Tenants first: their audit entries go with them (audit_logs is insert-only, so deleting
    // an actor user first would try to UPDATE actor_user_id and be refused).
    await systemPrisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await systemPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  return { tenant, user, member, device, session, studentLogin, staffLogin, cleanup };
}
