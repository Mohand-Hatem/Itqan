import { describe, expect, it } from "vitest";
import {
  CreateAnnouncementSchema,
  ListAnnouncementsQuerySchema,
  ListAnnouncementsResponseSchema,
} from "./announcements.js";

describe("Announcements Schemas (Shared)", () => {
  describe("CreateAnnouncementSchema", () => {
    it("validates a valid tenant-wide announcement", () => {
      const res = CreateAnnouncementSchema.safeParse({
        title: "General Maintenance",
        body: "The platform will be undergoing maintenance tonight.",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.title).toBe("General Maintenance");
        expect(res.data.courseId).toBeUndefined();
      }
    });

    it("validates a course-specific announcement", () => {
      const res = CreateAnnouncementSchema.safeParse({
        title: "Lecture Rescheduled",
        body: "Class tomorrow is moved to 5 PM.",
        courseId: "018f2d5c-3f41-7b00-8000-000000000001",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.courseId).toBe("018f2d5c-3f41-7b00-8000-000000000001");
      }
    });

    it("rejects blank title or body", () => {
      const blankTitle = CreateAnnouncementSchema.safeParse({
        title: "   ",
        body: "Valid body",
      });
      expect(blankTitle.success).toBe(false);

      const blankBody = CreateAnnouncementSchema.safeParse({
        title: "Valid Title",
        body: "   ",
      });
      expect(blankBody.success).toBe(false);
    });

    it("rejects invalid courseId UUID format", () => {
      const invalid = CreateAnnouncementSchema.safeParse({
        title: "Test",
        body: "Body",
        courseId: "not-a-uuid",
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("ListAnnouncementsQuerySchema", () => {
    it("applies default limit 20 and parses optional filters", () => {
      const res = ListAnnouncementsQuerySchema.parse({});
      expect(res.limit).toBe(20);
      expect(res.courseId).toBeUndefined();
      expect(res.cursor).toBeUndefined();
    });

    it("accepts valid cursor and custom limit", () => {
      const res = ListAnnouncementsQuerySchema.parse({
        limit: "50",
        cursor: "018f2d5c-3f41-7b00-8000-000000000002",
      });
      expect(res.limit).toBe(50);
      expect(res.cursor).toBe("018f2d5c-3f41-7b00-8000-000000000002");
    });
  });

  describe("ListAnnouncementsResponseSchema", () => {
    it("validates response structure with items and nullable cursor", () => {
      const res = ListAnnouncementsResponseSchema.safeParse({
        items: [
          {
            id: "018f2d5c-3f41-7b00-8000-000000000003",
            tenantId: "018f2d5c-3f41-7b00-8000-000000000004",
            courseId: null,
            title: "Welcome",
            body: "Welcome to our academy",
            publishedAt: new Date().toISOString(),
            createdBy: "018f2d5c-3f41-7b00-8000-000000000005",
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
      });

      expect(res.success).toBe(true);
    });
  });
});
