import { describe, expect, it } from "vitest";
import { AnalyticsOverviewResponseSchema } from "./analytics.js";

describe("AnalyticsOverviewResponseSchema", () => {
  it("validates full analytics overview payload", () => {
    const parsed = AnalyticsOverviewResponseSchema.safeParse({
      students: 42,
      activeStudents7d: 15,
      courses: 3,
      publishedItems: 25,
      quizParticipation: 120,
      averageGrade: 85.5,
      pendingRequests: 4,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.students).toBe(42);
      expect(parsed.data.activeStudents7d).toBe(15);
      expect(parsed.data.courses).toBe(3);
      expect(parsed.data.publishedItems).toBe(25);
      expect(parsed.data.quizParticipation).toBe(120);
      expect(parsed.data.averageGrade).toBe(85.5);
      expect(parsed.data.pendingRequests).toBe(4);
    }
  });

  it("accepts null averageGrade when no attempts exist", () => {
    const parsed = AnalyticsOverviewResponseSchema.safeParse({
      students: 0,
      activeStudents7d: 0,
      courses: 0,
      publishedItems: 0,
      quizParticipation: 0,
      averageGrade: null,
      pendingRequests: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.averageGrade).toBeNull();
    }
  });

  it("rejects negative numbers", () => {
    const parsed = AnalyticsOverviewResponseSchema.safeParse({
      students: -1,
      activeStudents7d: 0,
      courses: 0,
      publishedItems: 0,
      quizParticipation: 0,
      averageGrade: null,
      pendingRequests: 0,
    });
    expect(parsed.success).toBe(false);
  });
});
