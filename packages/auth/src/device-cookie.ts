// Device cookie: "<deviceId>.<secret>" (docs/05-auth-devices.md §2, ADR-004).
// Only sha256(secret) is stored. Never log the secret or the cookie value.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const DEVICE_COOKIE_NAME = "__Secure-lms_device";
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // seconds

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, no padding
const HASH = /^[0-9a-f]{64}$/;

export function createDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function verifyDeviceSecret(secret: string, storedHash: string): boolean {
  if (!HASH.test(storedHash)) return false;
  return timingSafeEqual(
    Buffer.from(hashDeviceSecret(secret), "hex"),
    Buffer.from(storedHash, "hex"),
  );
}

export function formatDeviceCookie(deviceId: string, secret: string): string {
  return `${deviceId}.${secret}`;
}

/** Returns null for anything malformed, so callers treat it as "no device cookie". */
export function parseDeviceCookie(
  value: string | null | undefined,
): { deviceId: string; secret: string } | null {
  const parts = value?.split(".");
  if (parts?.length !== 2) return null;
  const [deviceId, secret] = parts as [string, string];
  return UUID.test(deviceId) && SECRET.test(secret) ? { deviceId, secret } : null;
}

/** Reads the device cookie out of a raw Cookie header; null if absent or malformed. */
export function readDeviceCookie(
  cookieHeader: string | undefined,
): { deviceId: string; secret: string } | null {
  for (const part of cookieHeader?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === DEVICE_COOKIE_NAME) {
      return parseDeviceCookie(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/** Parent-domain cookie when a root domain is set; host-only otherwise (preview, ADR-009). */
export function deviceCookieOptions(rootDomain: string | undefined) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
    ...(rootDomain ? { domain: `.${rootDomain}` } : {}),
  };
}
