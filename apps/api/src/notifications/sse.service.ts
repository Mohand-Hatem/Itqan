import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Response } from "express";

export interface SseClientConnection {
  id: string;
  userId: string;
  tenantId: string;
  deviceId?: string | null;
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

  constructor() {
    // Send keep-alive ping comment every 25 seconds (prevent proxy timeouts)
    this.pingInterval = setInterval(() => {
      this.sendHeartbeat();
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

      return res.write(payload);
    } catch {
      return false;
    }
  }
}
