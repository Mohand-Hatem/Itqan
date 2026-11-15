import { randomUUID } from "node:crypto";
import {
  createTestClient,
  createTwoTenants,
  type FixtureTenant,
  runWithContext,
  withTenantScope,
} from "@itqan/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EMAIL_SEND_GAP_MS, NotificationsService } from "./notifications.service.js";
import { SseService } from "./sse.service.js";

const raw = createTestClient();
const scoped = withTenantScope(raw);
const service = new NotificationsService(scoped);

let a: FixtureTenant;
let b: FixtureTenant;
let cleanup: () => Promise<unknown>;

const inTenant = <T>(t: FixtureTenant, fn: () => Promise<T>) =>
  runWithContext(
    {
      kind: "tenant",
      tenantId: t.id,
      tenantSlug: t.slug,
      ip: "198.51.100.4",
      userAgent: "ua-test",
    },
    async () => await fn(),
  );

beforeAll(async () => {
  ({ a, b, cleanup } = await createTwoTenants(raw));
});

afterAll(async () => {
  await cleanup();
  await raw.$disconnect();
});

describe("NotificationsService (unit & transactional)", () => {
  it("paces bulk emails one gap apart to stay under the Resend rate limit (step 10.1)", async () => {
    vi.useFakeTimers();
    try {
      const paced = new NotificationsService(scoped);
      const sent: string[] = [];
      paced.dispatchEmail = async (input) => {
        sent.push(input.userId);
        return {};
      };
      const tx = {
        notification: {
          createManyAndReturn: async ({ data }: { data: Array<{ userId: string }> }) => data,
        },
      };
      const input = (userId: string) => ({
        tenantId: a.id,
        userId,
        type: "t",
        title: "x",
        body: "y",
        sendEmail: true,
      });

      const afterCommit = await paced.stage(tx, [input("u1"), input("u2"), input("u3")]);
      afterCommit();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toEqual(["u1"]); // the first goes at once
      await vi.advanceTimersByTimeAsync(EMAIL_SEND_GAP_MS);
      expect(sent).toEqual(["u1", "u2"]);
      await vi.advanceTimersByTimeAsync(EMAIL_SEND_GAP_MS);
      expect(sent).toEqual(["u1", "u2", "u3"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pushes over SSE only after the transaction commits, and never on rollback (step 9.11)", async () => {
    const pushed: string[] = [];
    const sse = {
      emitToUser: (_u: string, m: { data: { title: string } }) => pushed.push(m.data.title),
    };
    const withSse = new NotificationsService(scoped, sse as unknown as SseService);
    const user = await raw.user.create({
      data: { email: `notif-sse-${randomUUID()}@example.com`, name: "Sse User" },
    });

    await inTenant(a, () =>
      withSse.withTransaction(async (tx, postCommit) => {
        await withSse.create(
          { userId: user.id, type: "t", title: "committed", body: "b" },
          tx,
          postCommit,
        );
        expect(pushed).toEqual([]); // not yet: still inside the transaction
      }),
    );
    expect(pushed).toEqual(["committed"]);

    await expect(
      inTenant(a, () =>
        withSse.withTransaction(async (tx, postCommit) => {
          await withSse.create(
            { userId: user.id, type: "t", title: "rolled-back", body: "b" },
            tx,
            postCommit,
          );
          throw new Error("boom");
        }),
      ),
    ).rejects.toThrow("boom");
    expect(pushed).toEqual(["committed"]);

    // stage(): rows are written with the transaction; the push waits for afterCommit().
    const afterCommit = await inTenant(a, () =>
      scoped.$transaction((tx) =>
        withSse.stage(tx, [{ userId: user.id, type: "t", title: "staged", body: "b" }]),
      ),
    );
    expect(pushed).toEqual(["committed"]);
    afterCommit();
    expect(pushed).toEqual(["committed", "staged"]);
  });

  it("persists a notification in the tenant", async () => {
    const user = await raw.user.create({
      data: { email: `notif-user-${randomUUID()}@example.com`, name: "Notif User" },
    });

    const notif = await inTenant(a, () =>
      service.create({
        userId: user.id,
        type: "announcement",
        title: "Hello A",
        body: "Message body",
        data: { courseId: "c1" },
      }),
    );

    expect(notif.tenantId).toBe(a.id);
    expect(notif.userId).toBe(user.id);
    expect(notif.title).toBe("Hello A");
    expect(notif.readAt).toBeNull();

    const count = await inTenant(a, () => service.getUnreadCount(user.id));
    expect(count).toBe(1);
  });

  describe("transactional behavior", () => {
    it("writes inside a caller transaction and commits", async () => {
      const user = await raw.user.create({
        data: { email: `notif-tx-commit-${randomUUID()}@example.com`, name: "Tx Commit" },
      });

      const notif = await inTenant(a, () =>
        scoped.$transaction(async (tx) => {
          return await service.create(
            {
              userId: user.id,
              type: "grade_released",
              title: "Quiz graded",
              body: "Score: 100%",
            },
            tx,
          );
        }),
      );

      expect(notif.id).toBeDefined();
      const inDb = await raw.notification.findUnique({ where: { id: notif.id } });
      expect(inDb).not.toBeNull();
      expect(inDb?.title).toBe("Quiz graded");
    });

    it("writes nothing when the caller transaction rolls back", async () => {
      const user = await raw.user.create({
        data: { email: `notif-tx-rollback-${randomUUID()}@example.com`, name: "Tx Rollback" },
      });

      const uniqueTitle = `Rollback Test ${randomUUID()}`;

      await expect(
        inTenant(a, () =>
          scoped.$transaction(async (tx) => {
            await service.create(
              {
                userId: user.id,
                type: "alert",
                title: uniqueTitle,
                body: "Should not persist",
              },
              tx,
            );
            throw new Error("simulated database rollback");
          }),
        ),
      ).rejects.toThrow("simulated database rollback");

      const inDb = await raw.notification.findFirst({ where: { title: uniqueTitle } });
      expect(inDb).toBeNull();
    });
  });

  describe("post-commit dispatch guard", () => {
    it("executes registered post-commit callbacks after successful commit", async () => {
      const user = await raw.user.create({
        data: { email: `notif-post-commit-${randomUUID()}@example.com`, name: "Post Commit" },
      });

      let callbackRan = false;
      let notificationId: string | undefined;

      const result = await inTenant(a, () =>
        service.withTransaction(async (tx, postCommit) => {
          const row = await service.create(
            {
              userId: user.id,
              type: "device_request_decided",
              title: "Device Approved",
              body: "Your new device has been approved",
            },
            tx,
          );

          notificationId = row.id;

          postCommit(async () => {
            // Verify notification is already committed when callback runs
            const committedRow = await raw.notification.findUnique({
              where: { id: row.id },
            });
            if (committedRow) {
              callbackRan = true;
            }
          });

          return row;
        }),
      );

      expect(result.id).toBe(notificationId);
      expect(callbackRan).toBe(true);
    });

    it("discards post-commit callbacks when the transaction rolls back", async () => {
      const user = await raw.user.create({
        data: { email: `notif-post-fail-${randomUUID()}@example.com`, name: "Post Fail" },
      });

      let callbackRan = false;

      await expect(
        inTenant(a, () =>
          service.withTransaction(async (tx, postCommit) => {
            await service.create(
              {
                userId: user.id,
                type: "test",
                title: "Should Fail",
                body: "Fail body",
              },
              tx,
            );

            postCommit(() => {
              callbackRan = true;
            });

            throw new Error("Transaction exploded");
          }),
        ),
      ).rejects.toThrow("Transaction exploded");

      expect(callbackRan).toBe(false);
    });
  });

  describe("list, pagination and markRead", () => {
    it("lists notifications newest first and marks read", async () => {
      const user = await raw.user.create({
        data: { email: `notif-list-${randomUUID()}@example.com`, name: "List User" },
      });

      const n1 = await inTenant(a, () =>
        service.create({
          userId: user.id,
          type: "t1",
          title: "First",
          body: "B1",
        }),
      );

      const n2 = await inTenant(a, () =>
        service.create({
          userId: user.id,
          type: "t2",
          title: "Second",
          body: "B2",
        }),
      );

      const list1 = await inTenant(a, () => service.list(user.id, { limit: 10 }));
      expect(list1.unreadCount).toBe(2);
      expect(list1.items).toHaveLength(2);
      expect(list1.items[0]?.id).toBe(n2.id); // newest first
      expect(list1.items[1]?.id).toBe(n1.id);

      // Mark single notification read
      const mark1 = await inTenant(a, () => service.markRead(user.id, [n2.id]));
      expect(mark1.updatedCount).toBe(1);

      const list2 = await inTenant(a, () => service.list(user.id, { limit: 10 }));
      expect(list2.unreadCount).toBe(1);

      const unreadOnly = await inTenant(a, () =>
        service.list(user.id, { limit: 10, unreadOnly: true }),
      );
      expect(unreadOnly.items).toHaveLength(1);
      expect(unreadOnly.items[0]?.id).toBe(n1.id);

      // Mark all remaining read
      const markAll = await inTenant(a, () => service.markRead(user.id));
      expect(markAll.updatedCount).toBe(1);

      const list3 = await inTenant(a, () => service.list(user.id, { limit: 10 }));
      expect(list3.unreadCount).toBe(0);
    });

    it("does not leak notifications across tenants", async () => {
      const userA = await raw.user.create({
        data: { email: `notif-user-a-${randomUUID()}@example.com`, name: "User A" },
      });
      await raw.user.create({
        data: { email: `notif-user-b-${randomUUID()}@example.com`, name: "User B" },
      });

      const notifA = await inTenant(a, () =>
        service.create({
          userId: userA.id,
          type: "tenant.a",
          title: "Secret A",
          body: "A only",
        }),
      );

      // Tenant B queries with userA's ID
      const listFromB = await inTenant(b, () => service.list(userA.id, { limit: 10 }));
      expect(listFromB.items).toHaveLength(0);
      expect(listFromB.unreadCount).toBe(0);

      // Tenant B tries to mark read
      const markFromB = await inTenant(b, () => service.markRead(userA.id, [notifA.id]));
      expect(markFromB.updatedCount).toBe(0);
    });
  });
});
