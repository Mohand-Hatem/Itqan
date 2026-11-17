import { z } from "zod";

/** Version of the terms the guardian agrees to; stored with each electronic consent (10R.7). */
export const CONSENT_POLICY_VERSION = "2026-11-17";

export const GuardianConsentReason = {
  CONSENT_ALREADY_GIVEN: "CONSENT_ALREADY_GIVEN",
  CONSENT_NOT_REQUIRED: "CONSENT_NOT_REQUIRED",
  /** The guardian's address must differ from the student's own (ADR-014). */
  GUARDIAN_EMAIL_SAME_AS_STUDENT: "GUARDIAN_EMAIL_SAME_AS_STUDENT",
  CONSENT_REQUEST_LIMIT: "CONSENT_REQUEST_LIMIT",
  CONSENT_LINK_NOT_AVAILABLE: "CONSENT_LINK_NOT_AVAILABLE",
  NO_CONSENT_TO_WITHDRAW: "NO_CONSENT_TO_WITHDRAW",
} as const;

const relationship = z.enum(["parent", "legal_guardian", "other"]);
const guardianName = z.string().trim().min(2).max(100);

/** The guardian a minor names at registration or creation (optional): they get the email. */
export const GuardianInfoSchema = z
  .object({ name: guardianName, relationship, email: z.string().trim().toLowerCase().email() })
  .strict();
export type GuardianInfo = z.infer<typeof GuardianInfoSchema>;

/** Body of POST /me/guardian-consent/request and /students/:id/guardian-consent/request. */
export const GuardianConsentRequestSchema = z
  .object({ guardianName, relationship, guardianEmail: z.string().trim().toLowerCase().email() })
  .strict();
export type GuardianConsentRequestInput = z.infer<typeof GuardianConsentRequestSchema>;

/** Query of GET /guardian-consent/check (public). */
export const GuardianConsentCheckQuerySchema = z.object({ token: z.string().min(10) });

/** Body of POST /guardian-consent/confirm (public): the guardian agrees. */
export const GuardianConsentConfirmSchema = z
  .object({
    token: z.string().min(10),
    guardianName,
    relationship,
    agree: z.literal(true),
  })
  .strict();
export type GuardianConsentConfirmInput = z.infer<typeof GuardianConsentConfirmSchema>;

/**
 * Body of POST /students/:id/guardian-consent (offline): staff saw a signed form. Only a reference
 * to the document is kept, never a copy; it must not carry ID numbers (ADR-014).
 */
export const GuardianConsentOfflineSchema = z
  .object({
    guardianName,
    relationship,
    obtainedOn: z.iso.date(),
    evidenceReference: z.string().trim().min(3).max(200),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
export type GuardianConsentOfflineInput = z.infer<typeof GuardianConsentOfflineSchema>;

/**
 * What every academy may see about a person's consent. Guardian details are shown only to the
 * super admin and the academy that recorded them (`details`).
 */
export const GuardianConsentSummarySchema = z.object({
  status: z.enum(["not_required", "required", "pending", "given"]),
  method: z.enum(["electronic_email", "offline"]).nullable(),
  obtainedAt: z.string().nullable(),
  details: z
    .object({
      guardianName: z.string().nullable(),
      relationship: relationship.nullable(),
      guardianEmail: z.string().nullable(),
      evidenceReference: z.string().nullable(),
      notes: z.string().nullable(),
    })
    .nullable(),
});
export type GuardianConsentSummary = z.infer<typeof GuardianConsentSummarySchema>;

/** 201 of the two consent-request routes. The token is never returned: it goes only to the guardian. */
export const GuardianConsentRequestResultSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("pending"),
  expiresAt: z.string(),
});

/** 200 of GET /guardian-consent/check. */
export const GuardianConsentCheckResponseSchema = z.object({
  studentName: z.string(),
  tenantName: z.string().nullable(),
  policyVersion: z.string(),
  expiresAt: z.string(),
});

/** 201 of POST /students/:id/guardian-consent (offline record). */
export const GuardianConsentRecordResultSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("given"),
  method: z.literal("offline"),
  obtainedAt: z.string(),
});

/** 200 of confirm and withdraw. */
export const GuardianConsentStatusResultSchema = z.object({
  status: z.enum(["given", "withdrawn"]),
});
