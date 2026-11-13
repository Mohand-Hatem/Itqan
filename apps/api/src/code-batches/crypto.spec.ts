import { describe, expect, it } from "vitest";
import {
  CROCKFORD_ALPHABET,
  formatCode,
  generateCrockfordCode,
  hashAccessCode,
  normalizeAccessCode,
} from "./crypto.js";

describe("Access Code Cryptographic Pipeline (Unit)", () => {
  describe("generateCrockfordCode()", () => {
    it("generates 12 Crockford Base32 characters formatted as XXXX-XXXX-XXXX", () => {
      const code = generateCrockfordCode();
      expect(code.raw).toHaveLength(12);
      expect(code.formatted).toHaveLength(14); // 12 chars + 2 hyphens
      expect(code.formatted).toMatch(
        /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/,
      );
      expect(code.prefix).toBe(code.raw.slice(0, 4));
      expect(code.formatted.startsWith(code.prefix)).toBe(true);

      for (const char of code.raw) {
        expect(CROCKFORD_ALPHABET).toContain(char);
        expect(["I", "L", "O", "U"]).not.toContain(char);
      }
    });

    it("generates 500 unique codes with zero in-memory collisions", () => {
      const set = new Set<string>();
      for (let i = 0; i < 500; i++) {
        const { raw } = generateCrockfordCode();
        expect(set.has(raw)).toBe(false);
        set.add(raw);
      }
      expect(set.size).toBe(500);
    });
  });

  describe("normalizeAccessCode()", () => {
    it("strips hyphens and whitespace and converts to uppercase", () => {
      const input = " 7k9m - 2p4x - 8w0b ";
      const normalized = normalizeAccessCode(input);
      expect(normalized).toBe("7K9M2P4X8W0B");
    });

    it("maps visual aliases O/o to 0 and I/i/L/l to 1", () => {
      const withAliases = "7oml-I1po-wxy8";
      const normalized = normalizeAccessCode(withAliases);
      // 'o' -> '0', 'm', 'l' -> '1', 'I' -> '1', '1', 'p', 'o' -> '0', 'w', 'x', 'y', '8'
      expect(normalized).toBe("70M111P0WXY8");
    });

    it("rejects invalid length or invalid characters with 400 INVALID_CODE_FORMAT", () => {
      // Too short
      expect(() => normalizeAccessCode("7K9M-2P4X")).toThrow(/invalid/i);
      // Too long
      expect(() => normalizeAccessCode("7K9M-2P4X-8W0B-ABCD")).toThrow(/invalid/i);
      // Contains U (excluded in Crockford to prevent accidental obscenities)
      expect(() => normalizeAccessCode("7K9M-2P4X-8W0U")).toThrow(/invalid/i);
      // Contains special characters
      expect(() => normalizeAccessCode("7K9M-2P4X-8W0$")).toThrow(/invalid/i);
    });
  });

  describe("hashAccessCode()", () => {
    it("produces deterministic 64-char HMAC-SHA256 hex digest", () => {
      const code = "7K9M2P4X8W0B";
      const secret = "test-secret-key-123";
      const hash1 = hashAccessCode(code, secret);
      const hash2 = hashAccessCode(code, secret);

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);

      // Different code -> different hash
      const hashDiffCode = hashAccessCode("8NP23K9Y7M1A", secret);
      expect(hashDiffCode).not.toBe(hash1);

      // Different secret -> different hash
      const hashDiffSecret = hashAccessCode(code, "other-secret");
      expect(hashDiffSecret).not.toBe(hash1);
    });
  });

  describe("formatCode()", () => {
    it("formats 12-char code with hyphens", () => {
      expect(formatCode("7K9M2P4X8W0B")).toBe("7K9M-2P4X-8W0B");
    });
  });
});
