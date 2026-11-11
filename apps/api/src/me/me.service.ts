import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { getRequestContext, type Membership, PrismaClient } from "@itqan/database";
import { computePermissions, type MeResponse } from "@itqan/shared";

@Injectable()
export class MeService {
  constructor(@Inject(PrismaClient) private readonly db: PrismaClient) {}

  async getMe(
    userId: string,
    currentMembership?: Membership | null,
  ): Promise<MeResponse> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        emailVerified: true,
        isSuperAdmin: true,
        twoFactorEnabled: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const dbMemberships = await this.db.membership.findMany({
      where: { userId: user.id },
      include: {
        tenant: {
          select: {
            id: true,
            slug: true,
            name: true,
            settings: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const reqContext = getRequestContext();
    let tenantPayload: MeResponse["tenant"] = null;
    let membershipPayload: MeResponse["membership"] = null;

    if (reqContext?.kind === "tenant") {
      const tenantRecord = await this.db.tenant.findUnique({
        where: { id: reqContext.tenantId },
        select: {
          id: true,
          slug: true,
          name: true,
          settings: true,
        },
      });

      if (tenantRecord) {
        tenantPayload = {
          id: tenantRecord.id,
          slug: tenantRecord.slug,
          name: tenantRecord.name,
          settings: (tenantRecord.settings as Record<string, unknown>) ?? {},
        };
      }

      const activeMem =
        currentMembership ??
        dbMemberships.find((m) => m.tenantId === reqContext.tenantId);

      if (activeMem) {
        membershipPayload = {
          id: activeMem.id,
          role: activeMem.role,
          status: activeMem.status,
          phone: activeMem.phone ?? null,
          createdAt:
            activeMem.createdAt instanceof Date
              ? activeMem.createdAt.toISOString()
              : new Date(activeMem.createdAt).toISOString(),
        };
      }
    }

    const membershipsList: MeResponse["memberships"] = dbMemberships
      .filter((m) => m.tenant.status === "active")
      .map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        tenantSlug: m.tenant.slug,
        tenantName: m.tenant.name,
        role: m.role,
        status: m.status,
      }));

    const permissions = computePermissions(
      user.isSuperAdmin,
      membershipPayload?.role ?? null,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image ?? null,
        emailVerified: user.emailVerified,
        isSuperAdmin: user.isSuperAdmin,
        twoFactorEnabled: Boolean(user.twoFactorEnabled),
        status: user.status,
        createdAt: user.createdAt.toISOString(),
      },
      tenant: tenantPayload,
      membership: membershipPayload,
      memberships: membershipsList,
      permissions,
    };
  }
}
