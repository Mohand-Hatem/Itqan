import { describe, expect, it } from "vitest";
import {
  ListNotificationsQuerySchema,
  MarkNotificationsReadSchema,
  NotificationItemSchema,
} from "./notifications.js";

describe("Notification schemas", () => {
  it("parses valid notification item", () => {
    const valid = {
      id: "01932924-f7b7-7814-9ff5-585a2ec5092a",
      type: "announcement",
      title: "Welcome",
      body: "Welcome to the course",
      data: { courseId: "01932924-f7b7-7814-9ff5-585a2ec5092b" },
      readAt: null,
      createdAt: new Date().toISOString(),
    };
    const parsed = NotificationItemSchema.parse(valid);
    expect(parsed.id).toBe(valid.id);
    expect(parsed.readAt).toBeNull();
  });

  it("handles query params transformation", () => {
    const parsed = ListNotificationsQuerySchema.parse({
      unreadOnly: "true",
      limit: "50",
    });
    expect(parsed.unreadOnly).toBe(true);
    expect(parsed.limit).toBe(50);
  });

  it("validates mark as read payload", () => {
    const empty = MarkNotificationsReadSchema.parse({});
    expect(empty.ids).toBeUndefined();

    const withIds = MarkNotificationsReadSchema.parse({
      ids: ["01932924-f7b7-7814-9ff5-585a2ec5092a"],
    });
    expect(withIds.ids).toHaveLength(1);
  });
});
