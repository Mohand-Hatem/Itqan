import { describe, expect, it } from "vitest";
import {
  CreateGeneralSupportRequestSchema,
  RespondSupportRequestSchema,
  StudentSupportRequestListResponseSchema,
} from "./support-requests.js";

describe("support-requests schemas", () => {
  describe("CreateGeneralSupportRequestSchema", () => {
    it("accepts valid general support request body", () => {
      const parsed = CreateGeneralSupportRequestSchema.safeParse({
        message: "Hello, I cannot access lesson 2.",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.message).toBe("Hello, I cannot access lesson 2.");
      }
    });

    it("trims whitespace", () => {
      const parsed = CreateGeneralSupportRequestSchema.safeParse({
        message: "   Valid message with whitespace   ",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.message).toBe("Valid message with whitespace");
      }
    });

    it("rejects message shorter than 5 chars", () => {
      const parsed = CreateGeneralSupportRequestSchema.safeParse({
        message: "Hi",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects empty or whitespace-only message", () => {
      const parsed = CreateGeneralSupportRequestSchema.safeParse({
        message: "     ",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("RespondSupportRequestSchema", () => {
    it("accepts optional response string", () => {
      const parsed = RespondSupportRequestSchema.safeParse({
        response: "We have fixed the issue for your account.",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.response).toBe("We have fixed the issue for your account.");
      }
    });

    it("accepts empty object (optional response)", () => {
      const parsed = RespondSupportRequestSchema.safeParse({});
      expect(parsed.success).toBe(true);
    });
  });

  describe("StudentSupportRequestListResponseSchema", () => {
    it("parses student support request list", () => {
      const parsed = StudentSupportRequestListResponseSchema.safeParse({
        items: [
          {
            id: "018f2d5a-9b48-7d84-9092-23f5b72183c1",
            type: "general",
            status: "closed",
            message: "Need help with quiz 1",
            response: "Resolved",
            createdAt: new Date(),
            decidedAt: new Date(),
          },
        ],
        nextCursor: null,
      });
      expect(parsed.success).toBe(true);
    });
  });
});
