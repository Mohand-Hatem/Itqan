import { createHmac, randomBytes } from "node:crypto";
import process from "node:process";
import { BadRequestException } from "@nestjs/common";

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface GeneratedCode {
  raw: string;
  formatted: string;
  prefix: string;
}

/**
 * Generates a 60-bit cryptographically secure Crockford Base32 access code.
 * Formatted as XXXX-XXXX-XXXX.
 */
export function generateCrockfordCode(): GeneratedCode {
  const buf = randomBytes(8);
  let value = buf.readBigUInt64BE(0) & 0x0fff_ffff_ffff_ffffn;

  let raw = "";
  for (let i = 0; i < 12; i++) {
    const index = Number(value & 0x1fn);
    raw = CROCKFORD_ALPHABET[index] + raw;
    value >>= 5n;
  }

  const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  const prefix = raw.slice(0, 4);

  return { raw, formatted, prefix };
}

/**
 * Normalizes user-entered access code:
 * - Strips hyphens and whitespace
 * - Converts to uppercase
 * - Maps visual aliases: 'O' -> '0', 'I'/'L' -> '1'
 * - Validates length (12) and allowed Crockford Base32 characters
 */
export function normalizeAccessCode(input: string): string {
  const cleaned = input
    .replace(/[-\s]/g, "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(cleaned)) {
    throw new BadRequestException({
      statusCode: 400,
      reason: "INVALID_CODE_FORMAT",
      message: "The provided code is invalid. Check for typos.",
    });
  }

  return cleaned;
}

/**
 * Computes HMAC-SHA256 hex digest for a normalized access code.
 */
export function hashAccessCode(normalizedCode: string, secret?: string): string {
  const hmacSecret =
    secret ||
    process.env.ACCESS_CODE_HMAC_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    "dev-access-code-secret";

  return createHmac("sha256", hmacSecret).update(normalizedCode).digest("hex");
}

/**
 * Formats a clean 12-character code into XXXX-XXXX-XXXX.
 */
export function formatCode(rawOrNormalized: string): string {
  if (rawOrNormalized.length !== 12) return rawOrNormalized;
  return `${rawOrNormalized.slice(0, 4)}-${rawOrNormalized.slice(4, 8)}-${rawOrNormalized.slice(8, 12)}`;
}
