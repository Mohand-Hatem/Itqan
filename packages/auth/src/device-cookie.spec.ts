import { describe, expect, it } from "vitest";
import {
  DEVICE_COOKIE_MAX_AGE,
  DEVICE_COOKIE_NAME,
  createDeviceSecret,
  deviceCookieOptions,
  formatDeviceCookie,
  hashDeviceSecret,
  parseDeviceCookie,
  readDeviceCookie,
  verifyDeviceSecret,
} from "./device-cookie.js";

const DEVICE_ID = "01936d5e-7c1a-7b2c-9d3e-4f5a6b7c8d9e";

describe("device cookie helpers", () => {
  it("creates a 32-byte base64url secret, different every time", () => {
    const a = createDeviceSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, "base64url")).toHaveLength(32);
    expect(createDeviceSecret()).not.toBe(a);
  });

  it("hashes with sha256 and never returns the secret itself", () => {
    const secret = createDeviceSecret();
    const hash = hashDeviceSecret(secret);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(secret);
    expect(hashDeviceSecret(secret)).toBe(hash);
  });

  it("verifies the right secret and rejects a wrong or malformed one", () => {
    const secret = createDeviceSecret();
    const hash = hashDeviceSecret(secret);
    expect(verifyDeviceSecret(secret, hash)).toBe(true);
    expect(verifyDeviceSecret(createDeviceSecret(), hash)).toBe(false);
    expect(verifyDeviceSecret(secret, "not-a-hash")).toBe(false);
    expect(verifyDeviceSecret(secret, "")).toBe(false);
  });

  it("round-trips the cookie value", () => {
    const secret = createDeviceSecret();
    const value = formatDeviceCookie(DEVICE_ID, secret);
    expect(value).toBe(`${DEVICE_ID}.${secret}`);
    expect(parseDeviceCookie(value)).toEqual({ deviceId: DEVICE_ID, secret });
  });

  it.each([
    undefined,
    null,
    "",
    DEVICE_ID,
    `${DEVICE_ID}.`,
    `.${"a".repeat(43)}`,
    `not-a-uuid.${"a".repeat(43)}`,
    `${DEVICE_ID}.${"a".repeat(42)}`,
    `${DEVICE_ID}.${"a".repeat(43)}.extra`,
    `${DEVICE_ID}.${"a".repeat(42)}=`,
  ])("treats a malformed cookie (%s) as no cookie", (value) => {
    expect(parseDeviceCookie(value)).toBeNull();
  });

  it("reads the device cookie out of a Cookie header", () => {
    const secret = createDeviceSecret();
    const header = `better-auth.session_token=abc; ${DEVICE_COOKIE_NAME}=${formatDeviceCookie(DEVICE_ID, secret)}; x=1`;
    expect(readDeviceCookie(header)).toEqual({ deviceId: DEVICE_ID, secret });
    expect(readDeviceCookie("better-auth.session_token=abc")).toBeNull();
    expect(readDeviceCookie(`${DEVICE_COOKIE_NAME}=garbage`)).toBeNull();
    expect(readDeviceCookie(undefined)).toBeNull();
  });

  it("uses the parent domain when a root domain is set", () => {
    expect(deviceCookieOptions("itqan.app")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE,
      domain: ".itqan.app",
    });
  });

  it("is host-only when no root domain is set (preview, ADR-009)", () => {
    expect(deviceCookieOptions(undefined)).not.toHaveProperty("domain");
    expect(deviceCookieOptions("")).not.toHaveProperty("domain");
  });

  it("uses the __Secure- name and a 400-day lifetime", () => {
    expect(DEVICE_COOKIE_NAME).toBe("__Secure-lms_device");
    expect(DEVICE_COOKIE_MAX_AGE).toBe(400 * 24 * 60 * 60);
  });
});
