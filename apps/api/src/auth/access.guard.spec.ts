import {
  type ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { runWithContext, type PrismaClient } from "@itqan/database";
import { AccessReasonCode } from "@itqan/shared";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { AccessGuard } from "./access.guard.js";
import { ROLES_KEY, SUPER_ADMIN_ONLY_KEY } from "./roles.decorator.js";

function createMockContext(user?: unknown): {
  context: ExecutionContext;
  req: Request;
} {
  const req = {
    user,
    headers: {},
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

describe("AccessGuard (unit)", () => {
  it("allows access immediately when route is public", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockImplementation((key) => {
        if (key === "isPublic") return true;
        return undefined;
      }),
    } as unknown as Reflector;

    const mockDb = {} as PrismaClient;
    const guard = new AccessGuard(reflector, mockDb);
    const { context } = createMockContext();

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
  });

  it("throws UnauthorizedException if req.user is missing on protected route", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;

    const mockDb = {} as PrismaClient;
    const guard = new AccessGuard(reflector, mockDb);
    const { context } = createMockContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("throws ForbiddenException with USER_SUSPENDED when user status is suspended", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;

    const mockDb = {} as PrismaClient;
    const guard = new AccessGuard(reflector, mockDb);
    const { context } = createMockContext({
      id: "u-1",
      status: "suspended",
      isSuperAdmin: false,
    });

    try {
      await guard.canActivate(context);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        reason: string;
      };
      expect(response.reason).toBe(AccessReasonCode.USER_SUSPENDED);
    }
  });

  it("throws ForbiddenException with NO_ACCESS when non-superadmin accesses superadmin route", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockImplementation((key) => {
        if (key === SUPER_ADMIN_ONLY_KEY) return true;
        return undefined;
      }),
    } as unknown as Reflector;

    const mockDb = {} as PrismaClient;
    const guard = new AccessGuard(reflector, mockDb);
    const { context } = createMockContext({
      id: "u-1",
      status: "active",
      isSuperAdmin: false,
    });

    try {
      await guard.canActivate(context);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const response = (err as ForbiddenException).getResponse() as {
        reason: string;
      };
      expect(response.reason).toBe(AccessReasonCode.NO_ACCESS);
    }
  });

  it("allows superadmin on superadmin route", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockImplementation((key) => {
        if (key === SUPER_ADMIN_ONLY_KEY) return true;
        return undefined;
      }),
    } as unknown as Reflector;

    const mockDb = {} as PrismaClient;
    const guard = new AccessGuard(reflector, mockDb);
    const { context } = createMockContext({
      id: "sa-1",
      status: "active",
      isSuperAdmin: true,
    });

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
  });

  it("enforces tenant context rules: NO_ACCESS, TENANT_PAUSED, ROLE_FORBIDDEN", async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockImplementation((key) => {
        if (key === ROLES_KEY) return ["teacher"];
        return undefined;
      }),
    } as unknown as Reflector;

    // 1. Missing membership -> NO_ACCESS
    const mockDb1 = {
      membership: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const guard1 = new AccessGuard(reflector, mockDb1);
    const { context: ctx1 } = createMockContext({
      id: "u-1",
      status: "active",
      isSuperAdmin: false,
    });

    await runWithContext(
      { kind: "tenant", tenantId: "t-1", tenantSlug: "t-slug", ip: "127.0.0.1" },
      async () => {
        try {
          await guard1.canActivate(ctx1);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(ForbiddenException);
          const res = (err as ForbiddenException).getResponse() as {
            reason: string;
          };
          expect(res.reason).toBe(AccessReasonCode.NO_ACCESS);
        }
      },
    );

    // 2. Suspended membership -> NO_ACCESS
    const mockDb2 = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "m-1",
          role: "student",
          status: "suspended",
        }),
      },
    } as unknown as PrismaClient;
    const guard2 = new AccessGuard(reflector, mockDb2);
    const { context: ctx2 } = createMockContext({
      id: "u-2",
      status: "active",
      isSuperAdmin: false,
    });

    await runWithContext(
      { kind: "tenant", tenantId: "t-1", tenantSlug: "t-slug", ip: "127.0.0.1" },
      async () => {
        try {
          await guard2.canActivate(ctx2);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(ForbiddenException);
          const res = (err as ForbiddenException).getResponse() as {
            reason: string;
          };
          expect(res.reason).toBe(AccessReasonCode.NO_ACCESS);
        }
      },
    );

    // 3. Paused role in tenant -> TENANT_PAUSED
    const mockDb3 = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "m-3",
          role: "student",
          status: "active",
        }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({
          pausedRoles: ["student"],
        }),
      },
    } as unknown as PrismaClient;
    const guard3 = new AccessGuard(reflector, mockDb3);
    const { context: ctx3 } = createMockContext({
      id: "u-3",
      status: "active",
      isSuperAdmin: false,
    });

    await runWithContext(
      { kind: "tenant", tenantId: "t-1", tenantSlug: "t-slug", ip: "127.0.0.1" },
      async () => {
        try {
          await guard3.canActivate(ctx3);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(ForbiddenException);
          const res = (err as ForbiddenException).getResponse() as {
            reason: string;
          };
          expect(res.reason).toBe(AccessReasonCode.TENANT_PAUSED);
        }
      },
    );

    // 4. Role mismatch (student calling teacher-only route) -> ROLE_FORBIDDEN
    const mockDb4 = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "m-4",
          role: "student",
          status: "active",
        }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({
          pausedRoles: [],
        }),
      },
    } as unknown as PrismaClient;
    const guard4 = new AccessGuard(reflector, mockDb4);
    const { context: ctx4 } = createMockContext({
      id: "u-4",
      status: "active",
      isSuperAdmin: false,
    });

    await runWithContext(
      { kind: "tenant", tenantId: "t-1", tenantSlug: "t-slug", ip: "127.0.0.1" },
      async () => {
        try {
          await guard4.canActivate(ctx4);
          expect.fail("Should have thrown");
        } catch (err) {
          expect(err).toBeInstanceOf(ForbiddenException);
          const res = (err as ForbiddenException).getResponse() as {
            reason: string;
          };
          expect(res.reason).toBe(AccessReasonCode.ROLE_FORBIDDEN);
        }
      },
    );

    // 5. Matching role (teacher calling teacher route) -> allowed
    const mockDb5 = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          id: "m-5",
          role: "teacher",
          status: "active",
        }),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({
          pausedRoles: [],
        }),
      },
    } as unknown as PrismaClient;
    const guard5 = new AccessGuard(reflector, mockDb5);
    const { context: ctx5, req: req5 } = createMockContext({
      id: "u-5",
      status: "active",
      isSuperAdmin: false,
    });

    await runWithContext(
      { kind: "tenant", tenantId: "t-1", tenantSlug: "t-slug", ip: "127.0.0.1" },
      async () => {
        const allowed = await guard5.canActivate(ctx5);
        expect(allowed).toBe(true);
        expect(req5.membership).toBeDefined();
        expect(req5.membership?.role).toBe("teacher");
      },
    );
  });
});
