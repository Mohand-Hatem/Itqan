import { describe, expect, it } from "vitest";
import { AuditLogListQuerySchema, AuditLogListResponseSchema } from "./audit.js";

describe("audit schemas", () => {
  describe("AuditLogListQuerySchema", () => {
    it("accepts empty query and defaults limit to 50", () => {
      const parsed = AuditLogListQuerySchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.limit).toBe(50);
      }
    });

    it("parses actorUserId, action, from, to", () => {
      const parsed = AuditLogListQuerySchema.safeParse({
        actorUserId: "018f2d5a-9b48-7d84-9092-23f5b72183c1",
        action: "support_request.create",
        from: "2026-11-01T00:00:00Z",
        to: "2026-11-14T23:59:59Z",
        limit: 25,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.actorUserId).toBe("018f2d5a-9b48-7d84-9092-23f5b72183c1");
        expect(parsed.data.action).toBe("support_request.create");
        expect(parsed.data.from).toBeInstanceOf(Date);
        expect(parsed.data.to).toBeInstanceOf(Date);
        expect(parsed.data.limit).toBe(25);
      }
    });

    it("clamps limit min 1 max 100", () => {
      expect(AuditLogListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
      expect(AuditLogListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    });
  });

  describe("AuditLogListResponseSchema", () => {
    it("validates response payload", () => {
      const parsed = AuditLogListResponseSchema.safeParse({
        items: [
          {
            id: "018f2d5a-9b48-7d84-9092-23f5b72183c1",
            action: "course.create",
            targetType: "course",
            targetId: "018f2d5a-9b48-7d84-9092-23f5b72183c2",
            meta: { title: "Biology 101" },
            ip: "127.0.0.1",
            userAgent: "Mozilla/5.0",
            createdAt: new Date(),
            actor: {
              id: "018f2d5a-9b48-7d84-9092-23f5b72183c3",
              name: "Teacher Alice",
              email: "alice@example.com",
            },
          },
        ],
        nextCursor: null,
      });
      expect(parsed.success).toBe(true);
    });
  });
});
