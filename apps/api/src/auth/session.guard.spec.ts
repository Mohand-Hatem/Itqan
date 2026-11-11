import { type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Auth, AuthSession, AuthUser } from "@itqan/auth";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { SessionGuard } from "./session.guard.js";

function createMockContext(
  reqHeaders: Record<string, string | string[] | undefined> = {},
): {
  context: ExecutionContext;
  req: Request;
} {
  const req = {
    headers: reqHeaders,
  } as unknown as Request;

  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;

  return { context, req };
}

describe("SessionGuard", () => {
  it("allows unauthenticated access when route is marked public", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(true),
    } as unknown as Reflector;

    const mockAuth = {
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Auth;

    const guard = new SessionGuard(reflector, mockAuth);
    const { context, req } = createMockContext();

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(req.user).toBeUndefined();
    expect(req.session).toBeUndefined();
  });

  it("attaches user and session on public route when session is provided", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(true),
    } as unknown as Reflector;

    const mockUser = { id: "user-1", email: "public@example.com" } as AuthUser;
    const mockSession = { id: "sess-1", userId: "user-1" } as AuthSession;

    const mockAuth = {
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: mockUser,
          session: mockSession,
        }),
      },
    } as unknown as Auth;

    const guard = new SessionGuard(reflector, mockAuth);
    const { context, req } = createMockContext({
      cookie: "better-auth.session_token=test-token",
    });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(req.user).toEqual(mockUser);
    expect(req.session).toEqual(mockSession);
  });

  it("throws UnauthorizedException when route is protected and no session is found", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;

    const mockAuth = {
      api: {
        getSession: vi.fn().mockResolvedValue(null),
      },
    } as unknown as Auth;

    const guard = new SessionGuard(reflector, mockAuth);
    const { context } = createMockContext();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("throws UnauthorizedException when auth client throws an error", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;

    const mockAuth = {
      api: {
        getSession: vi.fn().mockRejectedValue(new Error("Database disconnected")),
      },
    } as unknown as Auth;

    const guard = new SessionGuard(reflector, mockAuth);
    const { context } = createMockContext({
      cookie: "better-auth.session_token=invalid",
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("authenticates and attaches user and session on protected route when valid", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;

    const mockUser = {
      id: "u-123",
      email: "teacher@example.com",
      name: "Teacher",
    } as AuthUser;
    const mockSession = {
      id: "s-456",
      userId: "u-123",
      token: "valid-token",
    } as AuthSession;

    const mockAuth = {
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: mockUser,
          session: mockSession,
        }),
      },
    } as unknown as Auth;

    const guard = new SessionGuard(reflector, mockAuth);
    const { context, req } = createMockContext({
      cookie: "better-auth.session_token=valid-token",
    });

    const allowed = await guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(req.user).toEqual(mockUser);
    expect(req.session).toEqual(mockSession);
  });
});
