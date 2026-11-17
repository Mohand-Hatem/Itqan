// 10R.7 (FR-A06, ADR-014): guardian consent is per person and global. Plain functions so the
// content gate, /me, provisioning and the student profile read it without a module dependency.
import { ForbiddenException } from "@nestjs/common";
import { systemPrisma } from "@itqan/database";
import { AccessReasonCode, type GuardianConsentSummary } from "@itqan/shared";

export type ConsentState = GuardianConsentSummary["status"];

/** The live row: `pending` or `given`. Legacy checkbox rows are history and never count (T8). */
export const LIVE_CONSENT = {
  status: { in: ["pending" as const, "given" as const] },
  method: { not: "legacy_checkbox" as const },
};

export async function consentStateOf(userId: string, isMinor: boolean): Promise<ConsentState> {
  if (!isMinor) return "not_required";
  const live = await systemPrisma.guardianConsent.findFirst({
    where: { userId, ...LIVE_CONSENT },
    select: { status: true },
  });
  return live?.status === "given" ? "given" : live?.status === "pending" ? "pending" : "required";
}

/** Closes course content and assessments for a minor until consent is recorded. */
export async function assertGuardianConsent(user: { id: string; isMinor?: boolean | null }) {
  if (!user.isMinor) return;
  if ((await consentStateOf(user.id, true)) === "given") return;
  throw new ForbiddenException({
    statusCode: 403,
    reason: AccessReasonCode.GUARDIAN_CONSENT_REQUIRED,
    message: "A guardian must consent before this content opens.",
  });
}

/**
 * What a viewer may see. Guardian details are personal data shared across academies: only the
 * super admin and the academy that recorded the consent see them.
 */
export async function consentSummaryOf(
  userId: string,
  isMinor: boolean,
  viewer: { isSuperAdmin: boolean; tenantId?: string },
): Promise<GuardianConsentSummary> {
  if (!isMinor) return { status: "not_required", method: null, obtainedAt: null, details: null };
  const live = await systemPrisma.guardianConsent.findFirst({ where: { userId, ...LIVE_CONSENT } });
  if (!live) return { status: "required", method: null, obtainedAt: null, details: null };
  const mayView = viewer.isSuperAdmin || (!!viewer.tenantId && live.recordedTenantId === viewer.tenantId);
  return {
    status: live.status === "given" ? "given" : "pending",
    method: live.method === "offline" ? "offline" : "electronic_email",
    obtainedAt: live.obtainedAt?.toISOString() ?? null,
    details: mayView
      ? {
          guardianName: live.guardianName,
          relationship: live.guardianRelationship,
          guardianEmail: live.guardianEmail,
          evidenceReference: live.evidenceReference,
          notes: live.notes,
        }
      : null,
  };
}
