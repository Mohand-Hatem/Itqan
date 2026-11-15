import { Inject, Injectable, Logger, Optional, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@itqan/database";
import type { Response } from "express";

export interface SseClientConnection {
  id: string;
  userId: string;
  tenantId: string;
  deviceId?: string | null;
  /** Better Auth session behind the stream; the heartbeat closes the stream once it is gone. */
  sessionId?: string | null;
  res: Response;
  connectedAt: Date;
}

export interface SseMessage {
  event?: string;
  data: unknown;
  id?: string;
  retry?: number;
}

export const MAX_SSE_STREAMS_PER_USER = 5;

@Injectable()
export class SseService implements OnModuleDestroy {
  private readonly logger = new Logger(SseService.name);
  private readonly connectionsByUser = new Map<string, SseClientConnection[]>();
  private pingInterval?: NodeJS.Timeout;

  constructor(@Optional() @Inject(PrismaClient) private readonly db?: Pick<PrismaClient, "session">) {
    // Every 25 s: keep-alive ping (prevents proxy timeouts) and close streams whose session ended.
    this.pingInterval = setInterval(() => {
      this.sendHeartbeat();
      void this.sweepEndedSessions().catch((err) =>
        this.logger.warn(`SSE session sweep failed: ${err}`),
      );
    }, 25_000);
    if (this.pingInterval.unref) {
      this.pingInterval.unref();
    }
  }

  onModuleDestroy() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    for (const [, conns] of this.connectionsByUser.entries()) {
      for (const conn of conns) {
        try {
          conn.res.end();
        } catch {
          // ignore
        }
      }
    }
    this.connectionsByUser.clear();
  }

  /**
   * Register a new client stream for the user.
   * If user already has MAX_SSE_STREAMS_PER_USER, terminate the oldest connection.
   */
  registerConnection(conn: SseClientConnection): void {
    let conns = this.connectionsByUser.get(conn.userId);
    if (!conns) {
      conns = [];
      this.connectionsByUser.set(conn.userId, conns);
    }

    if (conns.length >= MAX_SSE_STREAMS_PER_USER) {
      const oldest = conns.shift();
      if (oldest) {
        try {
          this.writeEvent(oldest.res, {
            event: "stream_closed",
            data: { reason: "LIMIT_EXCEEDED", message: "Concurrent stream limit reached (max 5)." },
          });
          oldest.res.end();
        } catch (err) {
          this.logger.debug(`Error terminating oldest stream for user ${conn.userId}: ${err}`);
        }
      }
    }

    conns.push(conn);

    // Initial connected event
    this.writeEvent(conn.res, {
      event: "connected",
      data: { connectedAt: conn.connectedAt.toISOString() },
    });

    const cleanup = () => {
      this.removeConnection(conn.userId, conn.id);
    };

    conn.res.on("close", cleanup);
    conn.res.on("finish", cleanup);
    conn.res.on("error", cleanup);
  }

  /**
   * Remove a connection by id.
   */
  removeConnection(userId: string, connectionId: string): void {
    const conns = this.connectionsByUser.get(userId);
    if (!conns) return;

    const idx = conns.findIndex((c) => c.id === connectionId);
    if (idx !== -1) {
      conns.splice(idx, 1);
    }

    if (conns.length === 0) {
      this.connectionsByUser.delete(userId);
    }
  }

  /**
   * Get active connection count for a user.
   */
  getConnectionCount(userId: string): number {
    return this.connectionsByUser.get(userId)?.length ?? 0;
  }

  /**
   * Get total active connection count across all users.
   */
  getTotalConnectionCount(): number {
    let count = 0;
    for (const conns of this.connectionsByUser.values()) {
      count += conns.length;
    }
    return count;
  }

  /**
   * Broadcast message to all active streams of a user on a given tenant (or all if tenant not restricted).
   */
  emitToUser(userId: string, message: SseMessage, tenantId?: string): number {
    const conns = this.connectionsByUser.get(userId);
    if (!conns || conns.length === 0) return 0;

    let delivered = 0;
    for (const conn of [...conns]) {
      if (tenantId && conn.tenantId !== tenantId) {
        continue;
      }
      const success = this.writeEvent(conn.res, message);
      if (success) {
        delivered++;
      } else {
        this.removeConnection(userId, conn.id);
      }
    }
    return delivered;
  }

  /**
   * Broadcast control event (e.g. device_revoked) to user or specific device.
   */
  emitControlEvent(userId: string, eventName: string, data: Record<string, unknown>, tenantId?: string): number {
    return this.emitToUser(userId, { event: eventName, data }, tenantId);
  }

  /**
   * Send a final event to the user's matching streams and end them. With no filter, every
   * stream of the user ends. Used when a device is revoked or sessions are ended.
   */
  closeStreams(
    userId: string,
    final: SseMessage,
    filter: { deviceId?: string; tenantId?: string } = {},
  ): number {
    const conns = this.connectionsByUser.get(userId);
    if (!conns) return 0;
    let closed = 0;
    for (const conn of [...conns]) {
      if (filter.deviceId && conn.deviceId !== filter.deviceId) continue;
      if (filter.tenantId && conn.tenantId !== filter.tenantId) continue;
      this.endConnection(conn, final);
      closed++;
    }
    return closed;
  }

  /**
   * Close streams whose session no longer exists or has expired. This catches every way a
   * session can end (suspension, role pause, tenant delete, expiry) without each path having
   * to know about SSE. Sessions are a global table, so no tenant filter applies.
   */
  async sweepEndedSessions(): Promise<number> {
    if (!this.db) return 0;
    const ids = new Set<string>();
    for (const conns of this.connectionsByUser.values()) {
      for (const conn of conns) if (conn.sessionId) ids.add(conn.sessionId);
    }
    if (ids.size === 0) return 0;

    const live = await this.db.session.findMany({
      where: { id: { in: [...ids] }, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    const liveIds = new Set(live.map((s) => s.id));

    let closed = 0;
    for (const conns of [...this.connectionsByUser.values()]) {
      for (const conn of [...conns]) {
        if (!conn.sessionId || liveIds.has(conn.sessionId)) continue;
        this.endConnection(conn, { event: "session_terminated", data: { reason: "SESSION_ENDED" } });
        closed++;
      }
    }
    return closed;
  }

  private endConnection(conn: SseClientConnection, final: SseMessage): void {
    this.writeEvent(conn.res, final);
    this.removeConnection(conn.userId, conn.id);
    try {
      conn.res.end();
    } catch {
      // already closed
    }
  }

  /**
   * Send heartbeat comment (: ping\n\n) to all connected clients.
   */
  private sendHeartbeat(): void {
    for (const [userId, conns] of this.connectionsByUser.entries()) {
      for (const conn of [...conns]) {
        try {
          conn.res.write(": ping\n\n");
        } catch {
          this.removeConnection(userId, conn.id);
        }
      }
    }
  }

  /**
   * Write an SSE formatted message to an Express Response.
   */
  private writeEvent(res: Response, message: SseMessage): boolean {
    try {
      if (res.writableEnded || res.destroyed) {
        return false;
      }

      let payload = "";
      if (message.id) {
        payload += `id: ${message.id}\n`;
      }
      if (message.event) {
        payload += `event: ${message.event}\n`;
      }
      if (message.retry) {
        payload += `retry: ${message.retry}\n`;
      }

      const dataStr =
        typeof message.data === "string"
          ? message.data
          : JSON.stringify(message.data);

      payload += `data: ${dataStr}\n\n`;

      // write() returning false only means the buffer is full; Node queues the data and the
      // socket is still open. A real disconnect fires "close", which removes the connection.
      res.write(payload);
      return true;
    } catch {
      return false;
    }
  }
}
