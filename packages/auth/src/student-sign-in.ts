// Student sign-in with device rules in one transaction (docs/05-auth-devices.md §3, ADR-011).
import { getCurrentAdapter, runWithTransaction } from "@better-auth/core/context";
import { createTenantLookup, getRootDomain, systemPrisma } from "@itqan/database";
import { AccessReasonCode, parseHost, StudentSignInBodySchema } from "@itqan/shared";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  DEVICE_COOKIE_NAME,
  createDeviceSecret,
  deviceCookieOptions,
  formatDeviceCookie,
  hashDeviceSecret,
  parseDeviceCookie,
  verifyDeviceSecret,
} from "./device-cookie.js";
import { isStaffOrSuperAdmin } from "./staff-mfa.js";
import { checkStudentAccess, verifyCredentials } from "./student-access.js";

type DeviceRow = { id: string; userId: string; status: string; secretHash: string };
type SessionRow = { deviceId?: string | null };

const tenants = createTenantLookup(systemPrisma);

const blocked = (code: AccessReasonCode, message: string) =>
  new APIError("FORBIDDEN", { code, message });

export function studentSignInPlugin() {
  return {
    id: "student-sign-in",
    // Lets Better Auth's transaction adapter read and write our devices table (Prisma model Device).
    schema: {
      device: {
        fields: {
          userId: { type: "string", required: true, references: { model: "user", field: "id" } },
          name: { type: "string", required: false },
          userAgent: { type: "string", required: false },
          fingerprintHint: { type: "string", required: false },
          status: { type: "string", required: true },
          secretHash: { type: "string", required: true, returned: false },
          lastSeenAt: { type: "date", required: false },
          revokedAt: { type: "date", required: false },
          createdAt: { type: "date", required: true },
          updatedAt: { type: "date", required: true },
        },
      },
    },
    endpoints: {
      signInStudent: createAuthEndpoint(
        "/sign-in/student",
        { method: "POST", body: StudentSignInBodySchema },
        async (ctx) => {
          const rootDomain = getRootDomain();
          // The tenant comes only from the Host header, never from the body.
          const target = parseHost(ctx.headers?.get("host") ?? undefined, rootDomain);
          const tenant = target.kind === "tenant" ? await tenants.findBySlug(target.slug) : null;
          if (!tenant) {
            throw new APIError("NOT_FOUND", { code: "TENANT_NOT_FOUND", message: "Unknown site." });
          }

          // 1. Password (Better Auth).
          const user = await verifyCredentials(ctx.context, ctx.body.email, ctx.body.password);
          if (!user) {
            throw new APIError("UNAUTHORIZED", {
              code: "INVALID_EMAIL_OR_PASSWORD",
              message: "Invalid email or password",
            });
          }
          if (!user.emailVerified) {
            throw new APIError("FORBIDDEN", {
              code: "EMAIL_NOT_VERIFIED",
              message: "Email not verified",
            });
          }

          // 2–3. Account, membership and tenant checks; staff use the TOTP sign-in.
          const access = await checkStudentAccess(user.id, tenant.id);
          if (!access.ok) throw blocked(access.code, access.message);

          // 4–8. One transaction: lock the user row, bind or reuse a device, one session at a time.
          const presented = parseDeviceCookie(ctx.getCookie(DEVICE_COOKIE_NAME));
          const { session, deviceCookie } = await runWithTransaction(
            ctx.context.adapter,
            async () => {
              const db = await getCurrentAdapter(ctx.context.adapter);
              const now = new Date();
              // UPDATE holds the row lock until commit, so parallel logins for one user queue here.
              const locked = await db.update<{ maxDevices: number }>({
                model: "user",
                where: [{ field: "id", value: user.id }],
                update: { updatedAt: now },
              });

              let device = presented
                ? await db.findOne<DeviceRow>({
                    model: "device",
                    where: [{ field: "id", value: presented.deviceId }],
                  })
                : null;
              const reusable =
                device?.userId === user.id &&
                device.status === "active" &&
                verifyDeviceSecret(presented!.secret, device.secretHash);
              let cookieValue = reusable ? formatDeviceCookie(device!.id, presented!.secret) : null;

              if (reusable) {
                await db.update({
                  model: "device",
                  where: [{ field: "id", value: device!.id }],
                  update: { lastSeenAt: now, updatedAt: now },
                });
              } else {
                const active = await db.count({
                  model: "device",
                  where: [
                    { field: "userId", value: user.id },
                    { field: "status", value: "active" },
                  ],
                });
                if (active >= (locked?.maxDevices ?? 1)) {
                  throw blocked(
                    AccessReasonCode.DEVICE_LIMIT,
                    "This account is linked to another device.",
                  );
                }
                const secret = createDeviceSecret();
                device = await db.create<Omit<DeviceRow, "id">, DeviceRow>({
                  model: "device",
                  data: {
                    userId: user.id,
                    status: "active",
                    secretHash: hashDeviceSecret(secret),
                    userAgent: ctx.headers?.get("user-agent") ?? null,
                    lastSeenAt: now,
                    createdAt: now,
                    updatedAt: now,
                  } as Omit<DeviceRow, "id">,
                });
                cookieValue = formatDeviceCookie(device.id, secret);
              }

              // Sessions on any tenant count; the same device on another tenant is allowed.
              const open = await db.findMany<SessionRow>({
                model: "session",
                where: [
                  { field: "userId", value: user.id },
                  { field: "expiresAt", operator: "gt", value: now },
                ],
              });
              if (open.some((s) => s.deviceId && s.deviceId !== device!.id)) {
                throw blocked(
                  AccessReasonCode.SESSION_ON_OTHER_DEVICE,
                  "Your account is signed in on another device. Sign out there first.",
                );
              }

              const created = await ctx.context.internalAdapter.createSession(user.id, false, {
                deviceId: device!.id,
                tenantId: tenant.id,
              });
              return { session: created, deviceCookie: cookieValue! };
            },
          );

          ctx.setCookie(DEVICE_COOKIE_NAME, deviceCookie, deviceCookieOptions(rootDomain));
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            token: session.token,
            user: { id: user.id, email: user.email, name: user.name },
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

/**
 * databaseHooks.session.create.before: only our endpoint creates sessions with a device,
 * so any other path (stock sign-in, /verify-email) must not create one for a student-only user.
 */
export async function guardStudentSession(session: { userId: string; deviceId?: unknown }) {
  if (session.deviceId) return;
  if (await isStaffOrSuperAdmin(session.userId)) return;
  const studentMemberships = await systemPrisma.membership.count({
    where: { userId: session.userId, role: "student" },
  });
  if (studentMemberships > 0) {
    throw blocked(AccessReasonCode.USE_STUDENT_SIGN_IN, "Use the student sign-in.");
  }
}
