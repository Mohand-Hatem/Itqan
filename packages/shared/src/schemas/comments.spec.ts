import { describe, expect, it } from "vitest";
import {
  CreateCommentSchema,
  ListCommentsQuerySchema,
  ListCommentsResponseSchema,
  UpdateCommentSchema,
} from "./comments.js";

describe("Comments Schemas (Shared)", () => {
  describe("CreateCommentSchema", () => {
    it("validates a top-level comment", () => {
      const res = CreateCommentSchema.safeParse({
        body: "Can you clarify rule #3 from the lecture?",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.body).toBe("Can you clarify rule #3 from the lecture?");
        expect(res.data.parentId).toBeUndefined();
      }
    });

    it("validates a threaded reply with parentId", () => {
      const res = CreateCommentSchema.safeParse({
        body: "Yes, rule #3 applies only when followed by a vowel.",
        parentId: "018f2d5c-3f41-7b00-8000-000000000001",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.parentId).toBe("018f2d5c-3f41-7b00-8000-000000000001");
      }
    });

    it("rejects empty or whitespace-only body", () => {
      const res = CreateCommentSchema.safeParse({
        body: "   ",
      });
      expect(res.success).toBe(false);
    });

    it("rejects invalid parentId UUID format", () => {
      const res = CreateCommentSchema.safeParse({
        body: "Valid reply",
        parentId: "not-a-uuid",
      });
      expect(res.success).toBe(false);
    });
  });

  describe("UpdateCommentSchema", () => {
    it("validates editing body", () => {
      const res = UpdateCommentSchema.safeParse({
        body: "Edited comment body.",
      });
      expect(res.success).toBe(true);
    });

    it("validates toggling hidden status", () => {
      const res = UpdateCommentSchema.safeParse({
        hidden: true,
      });
      expect(res.success).toBe(true);
    });
  });

  describe("ListCommentsQuerySchema", () => {
    it("applies default limit 50", () => {
      const res = ListCommentsQuerySchema.parse({});
      expect(res.limit).toBe(50);
      expect(res.cursor).toBeUndefined();
    });

    it("parses custom limit and cursor", () => {
      const res = ListCommentsQuerySchema.parse({
        limit: "25",
        cursor: "018f2d5c-3f41-7b00-8000-000000000002",
      });
      expect(res.limit).toBe(25);
      expect(res.cursor).toBe("018f2d5c-3f41-7b00-8000-000000000002");
    });
  });

  describe("ListCommentsResponseSchema", () => {
    it("validates response structure with author info", () => {
      const res = ListCommentsResponseSchema.safeParse({
        items: [
          {
            id: "018f2d5c-3f41-7b00-8000-000000000003",
            tenantId: "018f2d5c-3f41-7b00-8000-000000000004",
            contentItemId: "018f2d5c-3f41-7b00-8000-000000000005",
            authorMembershipId: "018f2d5c-3f41-7b00-8000-000000000006",
            parentId: null,
            body: "Great lecture, thanks!",
            hiddenAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            author: {
              membershipId: "018f2d5c-3f41-7b00-8000-000000000006",
              userId: "018f2d5c-3f41-7b00-8000-000000000007",
              name: "Student Ali",
              role: "student",
            },
          },
        ],
        nextCursor: null,
      });

      expect(res.success).toBe(true);
    });
  });
});
