import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_SSE_STREAMS_PER_USER, SseService } from "./sse.service.js";
import type { Response } from "express";

class MockResponse extends EventEmitter {
  writableEnded = false;
  destroyed = false;
  written: string[] = [];

  write(chunk: string): boolean {
    if (this.writableEnded || this.destroyed) return false;
    this.written.push(chunk);
    return true;
  }

  end(): void {
    this.writableEnded = true;
    this.emit("finish");
    this.emit("close");
  }
}

describe("SseService (unit)", () => {
  let service: SseService;

  beforeEach(() => {
    service = new SseService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe("concurrency cap", () => {
    it("caps active streams at 5 per user and closes the oldest connection", () => {
      const userId = "u1";
      const tenantId = "t1";
      const responses: MockResponse[] = [];

      for (let i = 0; i < MAX_SSE_STREAMS_PER_USER; i++) {
        const res = new MockResponse();
        responses.push(res);
        service.registerConnection({
          id: `conn-${i}`,
          userId,
          tenantId,
          res: res as unknown as Response,
          connectedAt: new Date(Date.now() + i * 1000),
        });
      }

      expect(service.getConnectionCount(userId)).toBe(5);
      expect(responses[0]?.writableEnded).toBe(false);

      // Register the 6th connection
      const sixthRes = new MockResponse();
      service.registerConnection({
        id: "conn-5",
        userId,
        tenantId,
        res: sixthRes as unknown as Response,
        connectedAt: new Date(),
      });

      // Oldest connection (responses[0]) must be terminated
      expect(responses[0]?.writableEnded).toBe(true);
      expect(responses[0]?.written.some((w) => w.includes("LIMIT_EXCEEDED"))).toBe(true);

      // Total count remains 5
      expect(service.getConnectionCount(userId)).toBe(5);
      expect(sixthRes.writableEnded).toBe(false);
    });
  });

  describe("socket cleanup", () => {
    it("deregisters socket from in-memory map when closed", () => {
      const userId = "u2";
      const tenantId = "t1";
      const res1 = new MockResponse();
      const res2 = new MockResponse();

      service.registerConnection({
        id: "c1",
        userId,
        tenantId,
        res: res1 as unknown as Response,
        connectedAt: new Date(),
      });

      service.registerConnection({
        id: "c2",
        userId,
        tenantId,
        res: res2 as unknown as Response,
        connectedAt: new Date(),
      });

      expect(service.getConnectionCount(userId)).toBe(2);

      // Close first connection
      res1.end();
      expect(service.getConnectionCount(userId)).toBe(1);

      // Close second connection
      res2.end();
      expect(service.getConnectionCount(userId)).toBe(0);
      expect(service.getTotalConnectionCount()).toBe(0);
    });
  });

  describe("events & control events", () => {
    it("emits events and control events to active user streams", () => {
      const userId = "u3";
      const resA = new MockResponse();
      const resB = new MockResponse();

      service.registerConnection({
        id: "c-a",
        userId,
        tenantId: "t-alpha",
        res: resA as unknown as Response,
        connectedAt: new Date(),
      });

      service.registerConnection({
        id: "c-b",
        userId,
        tenantId: "t-beta",
        res: resB as unknown as Response,
        connectedAt: new Date(),
      });

      // Control event (tenant-agnostic)
      service.emitControlEvent(userId, "device_revoked", { deviceId: "dev-99" });

      expect(resA.written.some((w) => w.includes("event: device_revoked") && w.includes("dev-99"))).toBe(
        true,
      );
      expect(resB.written.some((w) => w.includes("event: device_revoked") && w.includes("dev-99"))).toBe(
        true,
      );

      // Tenant-specific notification
      service.emitToUser(
        userId,
        {
          event: "notification.created",
          data: { id: "notif-1", title: "New Announcement" },
        },
        "t-alpha",
      );

      expect(resA.written.some((w) => w.includes("New Announcement"))).toBe(true);
      expect(resB.written.some((w) => w.includes("New Announcement"))).toBe(false);
    });
  });
});
