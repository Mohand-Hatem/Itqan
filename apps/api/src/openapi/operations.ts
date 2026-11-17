// 10R.8: the central API documentation map. One entry per NestJS operation, keyed by the id Nest
// generates (`Controller_method`, `[n]` for extra paths). The spec test fails when a route has no
// entry or an entry has no route, so the docs cannot drift from the code. "Who", authentication,
// tenant scope and rate-limit lines are NOT written here: document.ts generates them from the
// guard metadata (@Public, @Roles, @SuperAdminOnly, @Throttle).
import {
  AdminMemberCreateSchema,
  AdminMemberListQuerySchema,
  AdminMemberListResponseSchema,
  AdminMemberUpdateSchema,
  AdminSetPasswordSchema,
  AdminTenantCreateSchema,
  AdminTenantListQuerySchema,
  AdminTenantListResponseSchema,
  AdminTenantSoftDeleteResponseSchema,
  AdminTenantUpdateSchema,
  AdminUserUpdateResponseSchema,
  AdminUserUpdateSchema,
  AnalyticsOverviewResponseSchema,
  AnnouncementItemSchema,
  AssistantCreateSchema,
  AssistantDeleteResponseSchema,
  AssistantListQuerySchema,
  AssistantListResponseSchema,
  AttemptAnswersResponseSchema,
  AttemptExtendTimeResponseSchema,
  AttemptExtendTimeSchema,
  AttemptMoveDeviceResponseSchema,
  AttemptMoveDeviceSchema,
  AttemptResponseSchema,
  AttemptReviewResponseSchema,
  AttemptSubmitResponseSchema,
  AuditLogListQuerySchema,
  AuditLogListResponseSchema,
  CodeBatchCodesQuerySchema,
  CodeBatchCreateSchema,
  CodeBatchListQuerySchema,
  CodeRedeemSchema,
  CodeRegisterSchema,
  CommentItemSchema,
  ContentItemCreateSchema,
  ContentItemPatchSchema,
  ContentTreeQuerySchema,
  CoursePatchSchema,
  CourseCreateSchema,
  CourseQuerySchema,
  CreateAnnouncementSchema,
  CreateCommentSchema,
  CreateGeneralSupportRequestSchema,
  DeviceRequestBodySchema,
  EnrollmentCreateSchema,
  GuardianConsentCheckQuerySchema,
  GuardianConsentCheckResponseSchema,
  GuardianConsentConfirmSchema,
  GuardianConsentOfflineSchema,
  GuardianConsentRecordResultSchema,
  GuardianConsentRequestResultSchema,
  GuardianConsentRequestSchema,
  GuardianConsentStatusResultSchema,
  HealthCheckSchema,
  InvitationAcceptSchema,
  InvitationAcceptWithPasswordSchema,
  InvitationCheckQuerySchema,
  InvitationCreateSchema,
  InvitationListQuerySchema,
  InvitationRegisterSchema,
  ListAnnouncementsQuerySchema,
  ListAnnouncementsResponseSchema,
  ListCommentsQuerySchema,
  ListCommentsResponseSchema,
  ListNotificationsQuerySchema,
  ListNotificationsResponseSchema,
  MarkNotificationsReadResponseSchema,
  MarkNotificationsReadSchema,
  MeResponseSchema,
  ProgressUpdateSchema,
  ProvisionResultSchema,
  QuestionBankCreateSchema,
  QuestionBankQuerySchema,
  QuestionBankUpdateSchema,
  QuestionCreateSchema,
  QuestionQuerySchema,
  QuestionUpdateSchema,
  QuizCreateSchema,
  QuizListQuerySchema,
  QuizReleaseGradesResponseSchema,
  QuizUpdateSchema,
  RespondSupportRequestSchema,
  SaveAttemptAnswerSchema,
  SavedAttemptAnswerSchema,
  SignOutRequestBodySchema,
  StudentAccessPatchSchema,
  StudentCreateSchema,
  StudentListQuerySchema,
  SupportRequestListQuerySchema,
  TenantSettingsPatchSchema,
  UpdateCommentSchema,
  UploadCreateSchema,
  UploadPatchSchema,
} from "@itqan/shared";
import type { z } from "zod";

/** The 15 functional groups, in the order Swagger UI shows them. */
export const API_TAGS = [
  { name: "Health & System", description: "Liveness of the API and its database." },
  {
    name: "Authentication & Accounts",
    description:
      "Sign-in, sessions, passwords and email verification (Better Auth, served by Next.js under " +
      "/api/auth), and the signed-in user's own account. No two-factor routes (ADR-012).",
  },
  {
    name: "Platform Administration",
    description: "Super admin only, on the admin host: academies (tenants) and platform users.",
  },
  {
    name: "Staff Management",
    description: "Teachers and assistants of an academy: direct creation, roles, suspension, removal.",
  },
  {
    name: "Student Management",
    description: "Students of the current academy: direct creation, profile, status, device limit.",
  },
  {
    name: "Guardian Consent",
    description:
      "Consent for students under 18, once per person (ADR-014): guardian email link or offline " +
      "form. Until it is given, a minor's content and attempt routes answer 403 GUARDIAN_CONSENT_REQUIRED.",
  },
  {
    name: "Invitations & Joining",
    description: "Invitations for every role (one email each) and registration or acceptance with the token.",
  },
  {
    name: "Access Codes",
    description: "Code batches (CSV once, never emailed), registration with a code, redemption.",
  },
  {
    name: "Enrollments & Course Access",
    description: "Granting and ending lifetime course access, and the access check students use.",
  },
  {
    name: "Courses & Content",
    description: "Courses, the content tree, uploads to private storage and signed content links.",
  },
  {
    name: "Devices & Device Requests",
    description:
      "Student devices: revocation, device-change and sign-out requests, and the support requests " +
      "staff decide.",
  },
  {
    name: "Assessments & Attempts",
    description: "Question banks, questions, quizzes, and the student's attempts with rescue actions.",
  },
  { name: "Progress & Lesson Q&A", description: "Lesson progress and the comment threads on content items." },
  {
    name: "Notifications & Announcements",
    description: "In-app notifications, the server-sent event stream, and announcements.",
  },
  {
    name: "Academy Settings & Insights",
    description: "Public branding, academy settings, the audit log and dashboard numbers.",
  },
] as const;

export type ApiTag = (typeof API_TAGS)[number]["name"];
type ErrorCode = 400 | 401 | 403 | 404 | 409 | 410 | 429;

export interface OperationDoc {
  /** Public operationId (camelCase, unique). */
  id: string;
  tag: ApiTag;
  summary: string;
  description?: string;
  /** Business rules, one line each. */
  rules?: string[];
  /** Request body schema for POST/PUT/PATCH; `null` when the route takes none. */
  body?: z.ZodType | null;
  query?: z.ZodType;
  /** Schema of the success JSON body; the HTTP test helper checks real responses against it. */
  response?: z.ZodType;
  /** Reason codes by status, beyond the ones the guards add (generated). */
  errors?: Partial<Record<ErrorCode, string[]>>;
  /** Request body example; must parse with `body` (spec test). */
  example?: unknown;
  /**
   * The route is @Public so a person with no membership here yet can reach it, but the handler
   * itself requires a session (401 without one). The generated "Who" line says so.
   */
  sessionInHandler?: true;
}

const UUID = "0193f6a0-7c1e-7d3a-9a4b-2c5d6e7f8a9b";
const UUID2 = "0193f6a0-7c1e-7d3a-9a4b-2c5d6e7f8a9c";

export const operations: Record<string, OperationDoc> = {
  // ── Health & System ─────────────────────────────────────────────────────────────────────────
  HealthController_getHealth: {
    id: "getHealth",
    tag: "Health & System",
    summary: "Check that the API and database answer",
    description: "Works on any host (no tenant lookup). Used by the Docker health check and uptime monitoring.",
    response: HealthCheckSchema,
  },

  // ── Authentication & Accounts ───────────────────────────────────────────────────────────────
  MeController_getMe: {
    id: "getMe",
    tag: "Authentication & Accounts",
    summary: "Get the signed-in user, membership, academy and permissions",
    rules: [
      "Always answers, even while a password change is required, so the UI can send the user on.",
      "`user.mustChangePassword` true: show the change-password screen (FR-A08).",
      "`user.guardianConsent` `required` or `pending`: course content stays closed (FR-A06).",
    ],
    response: MeResponseSchema,
  },
  MeController_getMyDevices: {
    id: "listMyDevices",
    tag: "Authentication & Accounts",
    summary: "List the student's own devices",
    description:
      "Newest first; `current` marks the device of this session. Revoked devices are not listed. " +
      "Devices belong to the person, so every academy returns the same list.",
  },

  // ── Platform Administration ─────────────────────────────────────────────────────────────────
  AdminTenantsController_create: {
    id: "adminCreateTenant",
    tag: "Platform Administration",
    summary: "Create an academy with its first teacher",
    rules: [
      "The first teacher is created like any direct account: active, email unverified, must change password.",
      "An existing account is linked instead (audited); its password and profile are not touched.",
    ],
    body: AdminTenantCreateSchema,
    errors: { 409: ["SLUG_ALREADY_EXISTS", "MEMBERSHIP_ALREADY_EXISTS"] },
    example: {
      name: "Al-Noor Academy",
      slug: "alnoor",
      teacherEmail: "teacher@alnoor.example",
      teacherName: "Ahmed Hassan",
      temporaryPassword: "Temporary-Pass-2026",
    },
  },
  AdminTenantsController_list: {
    id: "adminListTenants",
    tag: "Platform Administration",
    summary: "List academies with usage numbers",
    description: "Each item carries `teachers[]`, `assistantCount` and `studentCount` (10R.5).",
    query: AdminTenantListQuerySchema,
    response: AdminTenantListResponseSchema,
    errors: { 400: ["INVALID_CURSOR"] },
  },
  AdminTenantsController_getById: {
    id: "adminGetTenant",
    tag: "Platform Administration",
    summary: "Get one academy",
    errors: { 404: ["TENANT_NOT_FOUND"] },
  },
  AdminTenantsController_update: {
    id: "adminUpdateTenant",
    tag: "Platform Administration",
    summary: "Rename an academy, change its slug or pause roles",
    description: "A paused role is blocked on this academy until it is unpaused (FR-T03).",
    body: AdminTenantUpdateSchema,
    errors: { 404: ["TENANT_NOT_FOUND"], 409: ["SLUG_ALREADY_EXISTS"] },
    example: { pausedRoles: ["student"] },
  },
  AdminTenantsController_softDelete: {
    id: "adminDeleteTenant",
    tag: "Platform Administration",
    summary: "Soft-delete an academy",
    description: "Its host stops answering and every session on it ends.",
    response: AdminTenantSoftDeleteResponseSchema,
    errors: { 404: ["TENANT_NOT_FOUND"] },
  },
  AdminUsersController_updateStatus: {
    id: "adminUpdateUser",
    tag: "Platform Administration",
    summary: "Suspend or reactivate a person, or change whether they are under 18",
    rules: [
      "Suspension ends all their sessions on every academy.",
      "A tenant's last active teacher cannot be suspended (409 LAST_TEACHER).",
      "`isMinor` is shared by every academy, so only the super admin changes it after creation (audited).",
    ],
    body: AdminUserUpdateSchema,
    response: AdminUserUpdateResponseSchema,
    errors: { 400: ["CANNOT_SUSPEND_SELF"], 404: ["USER_NOT_FOUND"], 409: ["LAST_TEACHER"] },
    example: { isMinor: false },
  },
  AdminUsersController_setPassword: {
    id: "adminSetUserPassword",
    tag: "Platform Administration",
    summary: "Set a new password for a user (FR-A07)",
    rules: [
      "Staff passwords need 12 characters, students 8.",
      "The user must change it at next sign-in; all their sessions end; devices stay.",
      "Never for a super admin (use the bootstrap `--recover`). Audited without the password.",
    ],
    body: AdminSetPasswordSchema,
    errors: { 400: ["PASSWORD_TOO_SHORT"], 403: ["ROLE_FORBIDDEN"], 404: ["USER_NOT_FOUND"] },
    example: { newPassword: "New-Temporary-2026" },
  },

  // ── Staff Management ────────────────────────────────────────────────────────────────────────
  AdminMembersController_list: {
    id: "adminListMembers",
    tag: "Staff Management",
    summary: "List an academy's members",
    description: "Default roles: teacher and assistant. `role` takes a comma list.",
    query: AdminMemberListQuerySchema,
    response: AdminMemberListResponseSchema,
    errors: { 400: ["INVALID_CURSOR"], 404: ["TENANT_NOT_FOUND"] },
  },
  AdminMembersController_create: {
    id: "adminCreateMember",
    tag: "Staff Management",
    summary: "Create any role directly, or link an existing account",
    rules: [
      "New email: name and password needed; the account is active with an unverified email, and no email is sent.",
      "Existing email: linked without touching its password, profile or other memberships.",
      "A first staff role on an existing account forces a password change (12-character rule).",
    ],
    body: AdminMemberCreateSchema,
    response: ProvisionResultSchema,
    errors: {
      400: ["NAME_REQUIRED", "PASSWORD_REQUIRED", "PASSWORD_TOO_SHORT"],
      404: ["TENANT_NOT_FOUND", "COURSE_NOT_FOUND"],
      409: ["MEMBERSHIP_ALREADY_EXISTS"],
    },
    example: { email: "assistant@alnoor.example", role: "assistant", name: "Mona Ali", password: "Assistant-Pass-2026" },
  },
  AdminMembersController_update: {
    id: "adminUpdateMember",
    tag: "Staff Management",
    summary: "Change a staff member's role or status",
    description: "Teacher ⇄ assistant and active ⇄ suspended. Students cannot be re-roled. Audited.",
    body: AdminMemberUpdateSchema,
    errors: { 400: ["NOT_STAFF"], 404: ["MEMBER_NOT_FOUND"], 409: ["LAST_TEACHER"] },
    example: { role: "teacher" },
  },
  AdminMembersController_remove: {
    id: "adminRemoveMember",
    tag: "Staff Management",
    summary: "Remove a teacher or assistant from an academy",
    description: "Their staff sessions end only if this was their last staff role. Audited.",
    errors: { 400: ["NOT_STAFF"], 404: ["MEMBER_NOT_FOUND"], 409: ["LAST_TEACHER"] },
  },
  AssistantsController_create: {
    id: "createAssistant",
    tag: "Staff Management",
    summary: "Create an assistant account directly",
    rules: [
      "A new account only: active, email unverified, must change password at first sign-in.",
      "An email that already has an account gets 409 USE_INVITATION: invite them with role assistant.",
    ],
    body: AssistantCreateSchema,
    errors: { 400: ["PASSWORD_TOO_SHORT"], 409: ["USE_INVITATION", "MEMBERSHIP_ALREADY_EXISTS"] },
    example: { name: "Mona Ali", email: "mona@alnoor.example", temporaryPassword: "Assistant-Pass-2026" },
  },
  AssistantsController_list: {
    id: "listAssistants",
    tag: "Staff Management",
    summary: "List this academy's assistants",
    query: AssistantListQuerySchema,
    response: AssistantListResponseSchema,
  },
  AssistantsController_delete: {
    id: "removeAssistant",
    tag: "Staff Management",
    summary: "Remove an assistant from this academy",
    description:
      "Their sessions on this academy end. Staff sessions end only if this was their last staff role. Audited.",
    response: AssistantDeleteResponseSchema,
    errors: { 404: ["ASSISTANT_NOT_FOUND"] },
  },

  // ── Student Management ──────────────────────────────────────────────────────────────────────
  StudentsController_create: {
    id: "createStudentAccount",
    tag: "Student Management",
    summary: "Create a student account directly",
    rules: [
      "The email must be new; an existing account needs an invitation (409 USE_INVITATION).",
      "Active at once, email unverified, no email sent. Password 8+; `requirePasswordChange` defaults to true.",
      "`isMinor` true: content stays closed until a guardian consents (`guardianConsent: required`).",
      "Audited, never with the password.",
    ],
    body: StudentCreateSchema,
    response: ProvisionResultSchema,
    errors: {
      400: ["PASSWORD_TOO_SHORT"],
      404: ["COURSE_NOT_FOUND"],
      409: ["USE_INVITATION", "MEMBERSHIP_ALREADY_EXISTS"],
    },
    example: {
      name: "Omar Ali",
      email: "omar@example.com",
      password: "Student-Pass-1",
      phone: "+966500000000",
      isMinor: true,
      courseIds: [UUID],
      requirePasswordChange: true,
    },
  },
  StudentsController_list: {
    id: "listStudents",
    tag: "Student Management",
    summary: "Search and filter this academy's students",
    query: StudentListQuerySchema,
  },
  StudentsController_getById: {
    id: "getStudent",
    tag: "Student Management",
    summary: "Get a student's profile, courses, devices and sessions",
    description:
      "`profile.guardianConsent.details` (guardian name, email, evidence) is shown only to the academy " +
      "that recorded the consent and to the super admin.",
    errors: { 404: ["STUDENT_NOT_FOUND"] },
  },
  StudentsAccessController_update: {
    id: "updateStudentAccess",
    tag: "Student Management",
    summary: "Suspend or reactivate a student here, or change their device limit",
    rules: [
      "Suspending ends the student's sessions on this academy only.",
      "`maxDevices` (1–10) is teacher and super admin only, and never revokes devices.",
    ],
    body: StudentAccessPatchSchema,
    errors: { 404: ["STUDENT_NOT_FOUND"] },
    example: { maxDevices: 2 },
  },
  StudentsAccessController_forceSignOut: {
    id: "forceSignOutStudent",
    tag: "Student Management",
    summary: "End all of a student's sessions",
    description: "On every academy; devices stay. By membership, so it reaches only this academy's students. Audited.",
    body: null,
    errors: { 404: ["STUDENT_NOT_FOUND"] },
  },

  // ── Guardian Consent ────────────────────────────────────────────────────────────────────────
  MyGuardianConsentController_request: {
    id: "requestMyGuardianConsent",
    tag: "Guardian Consent",
    summary: "Ask my guardian for consent by email",
    rules: [
      "The guardian's email must differ from the student's.",
      "One pending request per person: asking again sends a new link and the old one stops working.",
      "At most 3 emails an hour per student. The link is valid for 7 days.",
    ],
    body: GuardianConsentRequestSchema,
    response: GuardianConsentRequestResultSchema,
    errors: {
      400: ["GUARDIAN_EMAIL_SAME_AS_STUDENT"],
      409: ["CONSENT_ALREADY_GIVEN", "CONSENT_NOT_REQUIRED"],
      429: ["CONSENT_REQUEST_LIMIT"],
    },
    example: { guardianName: "Ali Hassan", relationship: "parent", guardianEmail: "ali.parent@example.com" },
  },
  StudentGuardianConsentController_request: {
    id: "requestStudentGuardianConsent",
    tag: "Guardian Consent",
    summary: "Send a student's guardian the consent email",
    description: "Same rules and limits as `requestMyGuardianConsent`, for a student of this academy.",
    body: GuardianConsentRequestSchema,
    response: GuardianConsentRequestResultSchema,
    errors: {
      400: ["GUARDIAN_EMAIL_SAME_AS_STUDENT"],
      404: ["MEMBERSHIP_NOT_FOUND"],
      409: ["CONSENT_ALREADY_GIVEN", "CONSENT_NOT_REQUIRED"],
      429: ["CONSENT_REQUEST_LIMIT"],
    },
    example: { guardianName: "Ali Hassan", relationship: "parent", guardianEmail: "ali.parent@example.com" },
  },
  StudentGuardianConsentController_recordOffline: {
    id: "recordOfflineGuardianConsent",
    tag: "Guardian Consent",
    summary: "Record consent from a signed offline form",
    rules: [
      "Only a reference to the document is stored, never a copy or an ID number.",
      "Replaces a pending email request. Opens content in every academy the student belongs to. Audited.",
    ],
    body: GuardianConsentOfflineSchema,
    response: GuardianConsentRecordResultSchema,
    errors: {
      400: ["INVALID_BODY"],
      404: ["MEMBERSHIP_NOT_FOUND"],
      409: ["CONSENT_ALREADY_GIVEN", "CONSENT_NOT_REQUIRED"],
    },
    example: {
      guardianName: "Ali Hassan",
      relationship: "legal_guardian",
      obtainedOn: "2026-11-01",
      evidenceReference: "Signed form #114, office file 2026",
    },
  },
  StudentGuardianConsentController_withdraw: {
    id: "withdrawGuardianConsent",
    tag: "Guardian Consent",
    summary: "Record that the guardian withdrew consent",
    description: "Content closes again in every academy. The record stays as history. Audited.",
    body: null,
    response: GuardianConsentStatusResultSchema,
    errors: { 404: ["MEMBERSHIP_NOT_FOUND", "NO_CONSENT_TO_WITHDRAW"] },
  },
  PublicGuardianConsentController_check: {
    id: "checkGuardianConsentLink",
    tag: "Guardian Consent",
    summary: "Show what a consent link is for",
    description: "Student name, academy and policy version for the guardian's page. Consumes nothing.",
    query: GuardianConsentCheckQuerySchema,
    response: GuardianConsentCheckResponseSchema,
    errors: { 410: ["CONSENT_LINK_NOT_AVAILABLE"] },
  },
  PublicGuardianConsentController_confirm: {
    id: "confirmGuardianConsent",
    tag: "Guardian Consent",
    summary: "Guardian confirms consent",
    description:
      "The token from the email is the only key, and it works once. Stores the policy version, time, IP and browser.",
    body: GuardianConsentConfirmSchema,
    response: GuardianConsentStatusResultSchema,
    errors: { 410: ["CONSENT_LINK_NOT_AVAILABLE"] },
    example: { token: "token-from-the-email-link", guardianName: "Ali Hassan", relationship: "parent", agree: true },
  },

  // ── Invitations & Joining ───────────────────────────────────────────────────────────────────
  InvitationsController_create: {
    id: "createInvitation",
    tag: "Invitations & Joining",
    summary: "Invite someone to this academy",
    rules: [
      "A teacher invites assistants and students; an assistant invites students only.",
      "Student invitations need at least one course; staff invitations take none.",
      "One email with a 72-hour link; the token is never returned.",
    ],
    body: InvitationCreateSchema,
    errors: { 403: ["ROLE_FORBIDDEN"], 404: ["COURSE_NOT_FOUND"], 409: ["MEMBERSHIP_ALREADY_EXISTS"] },
    example: { email: "student@example.com", role: "student", courseIds: [UUID] },
  },
  InvitationsController_list: {
    id: "listInvitations",
    tag: "Invitations & Joining",
    summary: "List this academy's invitations",
    query: InvitationListQuerySchema,
  },
  InvitationsController_check: {
    id: "checkInvitation",
    tag: "Invitations & Joining",
    summary: "Show what an invitation link is for",
    description: "Academy, role, courses and whether the email already has an account. Consumes nothing.",
    query: InvitationCheckQuerySchema,
    errors: { 410: ["INVITATION_NOT_AVAILABLE"] },
  },
  InvitationsController_resend: {
    id: "resendInvitation",
    tag: "Invitations & Joining",
    summary: "Send the invitation again with a new link",
    description: "The old link stops working.",
    body: null,
    errors: { 404: ["INVITATION_NOT_FOUND"], 409: ["INVITATION_NOT_AVAILABLE"] },
  },
  InvitationsController_revoke: {
    id: "revokeInvitation",
    tag: "Invitations & Joining",
    summary: "Revoke an invitation",
    body: null,
    errors: { 404: ["INVITATION_NOT_FOUND"] },
  },
  InvitationsController_accept: {
    id: "acceptInvitation",
    tag: "Invitations & Joining",
    summary: "Accept an invitation with the signed-in account",
    rules: [
      "Needs a session whose email matches the invitation.",
      "The email becomes verified; the membership gets the invited role.",
      "A first staff role forces a password change. No guardian-consent prompt.",
    ],
    body: InvitationAcceptSchema,
    sessionInHandler: true,
    errors: { 401: ["UNAUTHORIZED"], 409: ["INVITATION_NOT_AVAILABLE", "MEMBERSHIP_ALREADY_EXISTS"] },
    example: { token: "token-from-the-email-link" },
  },
  InvitationsController_acceptWithPassword: {
    id: "acceptInvitationWithPassword",
    tag: "Invitations & Joining",
    summary: "Accept an invitation for an account that cannot sign in yet",
    description:
      "For a pending account: the token proves the mailbox, the account's own password proves the account " +
      "(it never changes). The account becomes active.",
    body: InvitationAcceptWithPasswordSchema,
    errors: { 401: ["INVALID_EMAIL_OR_PASSWORD"], 409: ["INVITATION_NOT_AVAILABLE"] },
    example: { token: "token-from-the-email-link", password: "My-Own-Password-1" },
  },
  RegisterController_register: {
    id: "registerWithInvitation",
    tag: "Invitations & Joining",
    summary: "Create an account from an invitation",
    rules: [
      "Staff invitations need a 12+ password, student invitations 8+.",
      "The email is verified by the link itself; the account is active at once.",
      "A minor may name a guardian, who gets the consent email after the account is created.",
    ],
    body: InvitationRegisterSchema,
    errors: {
      400: ["PASSWORD_TOO_SHORT", "GUARDIAN_EMAIL_SAME_AS_STUDENT"],
      409: ["INVITATION_NOT_AVAILABLE", "USER_ALREADY_EXISTS"],
    },
    example: {
      token: "token-from-the-email-link",
      name: "Omar Ali",
      password: "Student-Pass-1",
      isMinor: true,
      guardian: { name: "Ali Hassan", relationship: "parent", email: "ali.parent@example.com" },
    },
  },
  AdminInvitationsController_create: {
    id: "adminCreateInvitation",
    tag: "Invitations & Joining",
    summary: "Invite any role into an academy",
    description: "Same body and rules as `createInvitation`; the link points at the academy's own address.",
    body: InvitationCreateSchema,
    errors: { 404: ["TENANT_NOT_FOUND", "COURSE_NOT_FOUND"], 409: ["MEMBERSHIP_ALREADY_EXISTS"] },
    example: { email: "teacher@alnoor.example", role: "teacher" },
  },

  // ── Access Codes ────────────────────────────────────────────────────────────────────────────
  CodeBatchesController_create: {
    id: "createCodeBatch",
    tag: "Access Codes",
    summary: "Generate a batch of access codes",
    description: "Returns the codes once as CSV. Only hashes are stored; codes are never emailed.",
    body: CodeBatchCreateSchema,
    errors: { 404: ["COURSE_NOT_FOUND"] },
    example: { courseId: UUID, count: 50, name: "Ramadan 2026" },
  },
  CodeBatchesController_list: {
    id: "listCodeBatches",
    tag: "Access Codes",
    summary: "List code batches with redemption counts",
    query: CodeBatchListQuerySchema,
  },
  CodeBatchesController_listCodes: {
    id: "listBatchCodes",
    tag: "Access Codes",
    summary: "List a batch's codes (prefix and status only)",
    query: CodeBatchCodesQuerySchema,
    errors: { 404: ["BATCH_NOT_FOUND"] },
  },
  CodeBatchesController_revoke: {
    id: "revokeCodeBatch",
    tag: "Access Codes",
    summary: "Revoke a batch's unredeemed codes",
    body: null,
    errors: { 404: ["BATCH_NOT_FOUND"] },
  },
  RegisterWithCodeController_register: {
    id: "registerWithCode",
    tag: "Access Codes",
    summary: "Create a student account with an access code",
    rules: [
      "The account is pending until the emailed verification link is used.",
      "No guardian-consent prompt; a minor may name a guardian, who gets the consent email.",
      "5 attempts per code per 15 minutes.",
    ],
    body: CodeRegisterSchema,
    errors: {
      400: ["GUARDIAN_EMAIL_SAME_AS_STUDENT"],
      404: ["CODE_NOT_FOUND", "COURSE_NOT_FOUND"],
      409: ["CODE_NOT_AVAILABLE", "USER_ALREADY_EXISTS"],
    },
    example: {
      code: "ITQ-ABCD-EFGH-JKLM",
      name: "Sara Omar",
      email: "sara@example.com",
      password: "Student-Pass-1",
      isMinor: false,
    },
  },
  CodesController_redeem: {
    id: "redeemCode",
    tag: "Access Codes",
    summary: "Redeem an access code with the signed-in account",
    description: "Never asks for guardian consent; the content gate decides access.",
    body: CodeRedeemSchema,
    sessionInHandler: true,
    errors: { 401: ["UNAUTHORIZED"], 404: ["CODE_NOT_FOUND"], 409: ["CODE_NOT_AVAILABLE", "ALREADY_ENROLLED"] },
    example: { code: "ITQ-ABCD-EFGH-JKLM" },
  },

  // ── Enrollments & Course Access ─────────────────────────────────────────────────────────────
  StudentEnrollmentsController_grant: {
    id: "enrollStudentInCourse",
    tag: "Enrollments & Course Access",
    summary: "Give a student lifetime access to a course",
    rules: [
      "Reactivates an ended enrollment.",
      "Sends an in-app notification, plus an email when the address is verified. Audited.",
      "A minor without consent is enrolled but the content stays closed.",
    ],
    body: EnrollmentCreateSchema,
    errors: {
      400: ["ALREADY_ENROLLED", "INVALID_TARGET_ROLE"],
      404: ["MEMBERSHIP_NOT_FOUND", "COURSE_NOT_FOUND"],
    },
    example: { courseId: UUID },
  },
  EnrollmentsController_terminate: {
    id: "terminateEnrollment",
    tag: "Enrollments & Course Access",
    summary: "End a student's access to a course",
    errors: { 404: ["ENROLLMENT_NOT_FOUND"] },
  },
  CourseAccessController_checkAccess: {
    id: "checkCourseAccess",
    tag: "Enrollments & Course Access",
    summary: "Check whether I may open a course",
    errors: {
      403: ["NO_ACCESS", "ENROLLMENT_REQUIRED", "ENROLLMENT_TERMINATED", "GUARDIAN_CONSENT_REQUIRED"],
      404: ["COURSE_NOT_FOUND"],
    },
  },

  // ── Courses & Content ───────────────────────────────────────────────────────────────────────
  CoursesController_create: {
    id: "createCourse",
    tag: "Courses & Content",
    summary: "Create a course (draft)",
    body: CourseCreateSchema,
    example: { title: "Tajweed for Beginners", description: "Twelve short lessons." },
  },
  CoursesController_list: {
    id: "listCourses",
    tag: "Courses & Content",
    summary: "List this academy's courses",
    query: CourseQuerySchema,
  },
  CoursesController_getById: {
    id: "getCourse",
    tag: "Courses & Content",
    summary: "Get one course",
    errors: { 404: ["COURSE_NOT_FOUND"] },
  },
  CoursesController_update: {
    id: "updateCourse",
    tag: "Courses & Content",
    summary: "Edit or publish a course",
    body: CoursePatchSchema,
    errors: { 404: ["COURSE_NOT_FOUND"] },
    example: { status: "published" },
  },
  CoursesController_delete: {
    id: "deleteCourse",
    tag: "Courses & Content",
    summary: "Delete a course (soft)",
    errors: { 404: ["COURSE_NOT_FOUND"] },
  },
  CourseTreeController_tree: {
    id: "getCourseTree",
    tag: "Courses & Content",
    summary: "Get a course's content tree",
    rules: [
      "Staff: the live tree; `?deleted=true` lists restorable items.",
      "Students: enrolled, course published; published items under published parents only.",
    ],
    query: ContentTreeQuerySchema,
    errors: {
      403: ["ENROLLMENT_REQUIRED", "ENROLLMENT_TERMINATED", "COURSE_NOT_PUBLISHED", "GUARDIAN_CONSENT_REQUIRED"],
      404: ["COURSE_NOT_FOUND"],
    },
  },
  ContentItemsController_create: {
    id: "createContentItem",
    tag: "Courses & Content",
    summary: "Add a node to the content tree",
    body: ContentItemCreateSchema,
    errors: { 400: ["INVALID_PARENT"], 404: ["COURSE_NOT_FOUND", "ASSET_NOT_FOUND"], 409: ["TREE_TOO_DEEP"] },
    example: { courseId: UUID, parentId: null, kind: "folder", title: "Unit 1" },
  },
  ContentItemsController_update: {
    id: "updateContentItem",
    tag: "Courses & Content",
    summary: "Rename, move, reorder or publish a content item",
    body: ContentItemPatchSchema,
    errors: { 404: ["CONTENT_ITEM_NOT_FOUND"], 409: ["TREE_CYCLE", "TREE_TOO_DEEP"] },
    example: { published: true },
  },
  ContentItemsController_remove: {
    id: "deleteContentItem",
    tag: "Courses & Content",
    summary: "Delete a branch of the content tree (soft)",
    errors: { 404: ["CONTENT_ITEM_NOT_FOUND"] },
  },
  ContentItemsController_restore: {
    id: "restoreContentItem",
    tag: "Courses & Content",
    summary: "Restore a deleted branch",
    body: null,
    errors: { 404: ["CONTENT_ITEM_NOT_FOUND"], 409: ["PARENT_DELETED"] },
  },
  ContentItemsController_getAccess: {
    id: "getContentItemAccess",
    tag: "Courses & Content",
    summary: "Get signed view or download links for a content item",
    description: "Videos carry a watermark. Staff may preview unpublished items.",
    errors: {
      403: ["ENROLLMENT_REQUIRED", "ENROLLMENT_TERMINATED", "COURSE_NOT_PUBLISHED", "GUARDIAN_CONSENT_REQUIRED"],
      404: ["CONTENT_ITEM_NOT_FOUND"],
    },
  },
  UploadsController_create: {
    id: "createUpload",
    tag: "Courses & Content",
    summary: "Start an upload to private storage",
    description:
      "Returns a pending asset and a 15-minute PUT URL signed for that exact Content-Type and Content-Length.",
    body: UploadCreateSchema,
    errors: { 400: ["UPLOAD_TYPE_NOT_ALLOWED", "UPLOAD_TOO_LARGE"] },
    example: { fileName: "lesson-1.pdf", mimeType: "application/pdf", size: 204800, purpose: "content" },
  },
  UploadsController_confirm: {
    id: "confirmUpload",
    tag: "Courses & Content",
    summary: "Mark an uploaded file ready",
    description: "Checks the stored file. Calling it again returns the ready asset.",
    body: null,
    errors: { 404: ["ASSET_NOT_FOUND"], 409: ["UPLOAD_NOT_FOUND", "UPLOAD_MISMATCH"] },
  },
  UploadsController_setDownloadPolicy: {
    id: "setDownloadPolicy",
    tag: "Courses & Content",
    summary: "Allow or block downloading a file",
    body: UploadPatchSchema,
    errors: { 404: ["ASSET_NOT_FOUND"] },
    example: { downloadPolicy: "downloadable" },
  },

  // ── Devices & Device Requests ───────────────────────────────────────────────────────────────
  DevicesController_revoke: {
    id: "revokeStudentDevice",
    tag: "Devices & Device Requests",
    summary: "Revoke a student's device",
    rules: [
      "Ends every session on that device and closes its event streams (`device_revoked`). Audited.",
      "Devices are per person, so the student is signed out of that browser in every academy.",
      "Answers 200 also when the device was already revoked.",
    ],
    body: null,
    errors: { 404: ["DEVICE_NOT_FOUND"] },
  },
  DeviceRequestsController_create: {
    id: "requestDeviceChange",
    tag: "Devices & Device Requests",
    summary: "Ask to use a new device (password re-check)",
    description:
      "Sets the device cookie of a new pending device. The same browser asking again gets the same request.",
    body: DeviceRequestBodySchema,
    errors: {
      401: ["INVALID_EMAIL_OR_PASSWORD"],
      403: ["USER_SUSPENDED", "NO_ACCESS", "TENANT_PAUSED", "USE_STAFF_SIGN_IN", "EMAIL_NOT_VERIFIED"],
      409: ["DEVICE_REQUEST_NOT_NEEDED", "REQUEST_ALREADY_OPEN"],
    },
    example: { email: "omar@example.com", password: "Student-Pass-1", message: "New laptop" },
  },
  SignOutRequestsController_create: {
    id: "requestSignOutOther",
    tag: "Devices & Device Requests",
    summary: "Ask staff to sign out my other device (password re-check)",
    body: SignOutRequestBodySchema,
    errors: {
      401: ["INVALID_EMAIL_OR_PASSWORD"],
      403: ["USER_SUSPENDED", "NO_ACCESS", "TENANT_PAUSED", "USE_STAFF_SIGN_IN", "EMAIL_NOT_VERIFIED"],
      409: ["SIGN_OUT_REQUEST_NOT_NEEDED", "DEVICE_LIMIT"],
    },
    example: { email: "omar@example.com", password: "Student-Pass-1" },
  },
  SupportRequestsController_create: {
    id: "createSupportRequest",
    tag: "Devices & Device Requests",
    summary: "Send a general support request",
    body: CreateGeneralSupportRequestSchema,
  },
  SupportRequestsController_list: {
    id: "listSupportRequests",
    tag: "Devices & Device Requests",
    summary: "List support requests",
    description: "Staff see this academy's requests; a student sees their own.",
    query: SupportRequestListQuerySchema,
  },
  SupportRequestsController_approve: {
    id: "approveSupportRequest",
    tag: "Devices & Device Requests",
    summary: "Approve a device-change or sign-out request",
    description: "404 (no reason code) when the request is not in this academy.",
    rules: [
      "Device change: revokes just enough least-recently-used devices and activates the pending one.",
      "Sign-out: ends all the student's sessions; devices stay. Audited.",
    ],
    body: null,
    errors: { 409: ["REQUEST_NOT_OPEN", "REQUEST_STALE"] },
  },
  SupportRequestsController_reject: {
    id: "rejectSupportRequest",
    tag: "Devices & Device Requests",
    summary: "Reject a device-change or sign-out request",
    description: "A rejected device change revokes its pending device. Audited.",
    body: null,
    errors: { 409: ["REQUEST_NOT_OPEN"] },
  },
  SupportRequestsController_close: {
    id: "closeSupportRequest",
    tag: "Devices & Device Requests",
    summary: "Answer and close a general support request",
    body: RespondSupportRequestSchema,
    errors: { 409: ["REQUEST_NOT_OPEN"] },
  },

  // ── Assessments & Attempts ──────────────────────────────────────────────────────────────────
  QuestionBanksController_create: {
    id: "createQuestionBank",
    tag: "Assessments & Attempts",
    summary: "Create a question bank",
    body: QuestionBankCreateSchema,
  },
  QuestionBanksController_list: {
    id: "listQuestionBanks",
    tag: "Assessments & Attempts",
    summary: "List question banks",
    query: QuestionBankQuerySchema,
  },
  QuestionBanksController_getById: {
    id: "getQuestionBank",
    tag: "Assessments & Attempts",
    summary: "Get a question bank",
    errors: { 404: ["BANK_NOT_FOUND"] },
  },
  QuestionBanksController_update: {
    id: "updateQuestionBank",
    tag: "Assessments & Attempts",
    summary: "Rename or describe a question bank",
    body: QuestionBankUpdateSchema,
    errors: { 404: ["BANK_NOT_FOUND"] },
  },
  QuestionBanksController_delete: {
    id: "deleteQuestionBank",
    tag: "Assessments & Attempts",
    summary: "Delete a question bank",
    errors: { 404: ["BANK_NOT_FOUND"] },
  },
  QuestionsController_create: {
    id: "createQuestion",
    tag: "Assessments & Attempts",
    summary: "Add a question to a bank",
    body: QuestionCreateSchema,
    errors: { 404: ["BANK_NOT_FOUND"] },
  },
  QuestionsController_listByBank: {
    id: "listBankQuestions",
    tag: "Assessments & Attempts",
    summary: "List a bank's questions",
    query: QuestionQuerySchema,
    errors: { 404: ["BANK_NOT_FOUND"] },
  },
  QuestionsController_getById: {
    id: "getQuestion",
    tag: "Assessments & Attempts",
    summary: "Get a question with its options",
    errors: { 404: ["QUESTION_NOT_FOUND"] },
  },
  QuestionsController_update: {
    id: "updateQuestion",
    tag: "Assessments & Attempts",
    summary: "Edit a question",
    body: QuestionUpdateSchema,
    errors: { 404: ["QUESTION_NOT_FOUND"] },
  },
  QuestionsController_delete: {
    id: "deleteQuestion",
    tag: "Assessments & Attempts",
    summary: "Delete a question",
    errors: { 404: ["QUESTION_NOT_FOUND"] },
  },
  QuizzesController_create: {
    id: "createQuiz",
    tag: "Assessments & Attempts",
    summary: "Create a quiz (unpublished)",
    body: QuizCreateSchema,
    errors: { 404: ["COURSE_NOT_FOUND"] },
  },
  QuizzesController_list: {
    id: "listQuizzes",
    tag: "Assessments & Attempts",
    summary: "List quizzes",
    query: QuizListQuerySchema,
  },
  QuizzesController_getById: {
    id: "getQuiz",
    tag: "Assessments & Attempts",
    summary: "Get a quiz with its settings and questions",
    errors: { 404: ["QUIZ_NOT_FOUND"] },
  },
  QuizzesController_update: {
    id: "updateQuiz",
    tag: "Assessments & Attempts",
    summary: "Change a quiz's settings, targets or questions",
    body: QuizUpdateSchema,
    errors: { 404: ["QUIZ_NOT_FOUND"] },
  },
  QuizzesController_delete: {
    id: "deleteQuiz",
    tag: "Assessments & Attempts",
    summary: "Delete a quiz (soft)",
    errors: { 404: ["QUIZ_NOT_FOUND"] },
  },
  QuizzesController_publish: {
    id: "publishQuiz",
    tag: "Assessments & Attempts",
    summary: "Publish a quiz",
    body: null,
    errors: { 404: ["QUIZ_NOT_FOUND"] },
  },
  QuizzesController_unpublish: {
    id: "unpublishQuiz",
    tag: "Assessments & Attempts",
    summary: "Unpublish a quiz",
    body: null,
    errors: { 404: ["QUIZ_NOT_FOUND"] },
  },
  QuizzesController_releaseGrades: {
    id: "releaseQuizGrades",
    tag: "Assessments & Attempts",
    summary: "Release a quiz's grades now",
    body: null,
    response: QuizReleaseGradesResponseSchema,
    errors: { 404: ["QUIZ_NOT_FOUND"] },
  },
  AttemptsController_startOrResume: {
    id: "startOrResumeAttempt",
    tag: "Assessments & Attempts",
    summary: "Start a quiz attempt, or resume the open one",
    description: "Questions come without answers. Needs a registered device.",
    body: null,
    response: AttemptResponseSchema,
    errors: {
      400: ["QUIZ_NOT_PUBLISHED", "QUIZ_NOT_OPEN", "QUIZ_CLOSED"],
      403: ["ENROLLMENT_REQUIRED", "GUARDIAN_CONSENT_REQUIRED", "DEVICE_NOT_REGISTERED"],
      404: ["QUIZ_NOT_FOUND"],
    },
  },
  AttemptsController_getAttempt: {
    id: "getAttempt",
    tag: "Assessments & Attempts",
    summary: "Get my attempt (questions, no answers)",
    response: AttemptResponseSchema,
    errors: { 403: ["GUARDIAN_CONSENT_REQUIRED"], 404: ["ATTEMPT_NOT_FOUND"] },
  },
  AttemptsController_saveAnswer: {
    id: "saveAttemptAnswer",
    tag: "Assessments & Attempts",
    summary: "Autosave one answer",
    body: SaveAttemptAnswerSchema,
    response: SavedAttemptAnswerSchema,
    errors: { 403: ["GUARDIAN_CONSENT_REQUIRED"], 404: ["ATTEMPT_NOT_FOUND"] },
    example: { selectedOptionIds: [UUID2] },
  },
  AttemptsController_getAnswers: {
    id: "listAttemptAnswers",
    tag: "Assessments & Attempts",
    summary: "List my saved answers",
    response: AttemptAnswersResponseSchema,
    errors: { 403: ["GUARDIAN_CONSENT_REQUIRED"], 404: ["ATTEMPT_NOT_FOUND"] },
  },
  AttemptsController_submit: {
    id: "submitAttempt",
    tag: "Assessments & Attempts",
    summary: "Submit my attempt",
    body: null,
    response: AttemptSubmitResponseSchema,
    errors: { 403: ["GUARDIAN_CONSENT_REQUIRED"], 404: ["ATTEMPT_NOT_FOUND"] },
  },
  AttemptsController_getReview: {
    id: "getAttemptReview",
    tag: "Assessments & Attempts",
    summary: "Review my submitted attempt",
    description: "Correct answers appear only after the quiz's configured review release.",
    response: AttemptReviewResponseSchema,
    errors: { 403: ["GUARDIAN_CONSENT_REQUIRED"], 404: ["ATTEMPT_NOT_FOUND"] },
  },
  AttemptsController_extendTime: {
    id: "extendAttemptTime",
    tag: "Assessments & Attempts",
    summary: "Give a student extra time (rescue)",
    description: "Can reopen a submitted or expired attempt. Audited.",
    body: AttemptExtendTimeSchema,
    response: AttemptExtendTimeResponseSchema,
    errors: { 404: ["ATTEMPT_NOT_FOUND"] },
    example: { extraMinutes: 10, reason: "Power cut" },
  },
  AttemptsController_moveDevice: {
    id: "moveAttemptDevice",
    tag: "Assessments & Attempts",
    summary: "Move an open attempt to another device (rescue)",
    body: AttemptMoveDeviceSchema,
    response: AttemptMoveDeviceResponseSchema,
    errors: { 404: ["ATTEMPT_NOT_FOUND"] },
  },

  // ── Progress & Lesson Q&A ───────────────────────────────────────────────────────────────────
  ProgressController_save: {
    id: "saveProgress",
    tag: "Progress & Lesson Q&A",
    summary: "Save my progress on a content item",
    description: "Completing twice keeps the first time. `videoPositionSec` is for videos only.",
    body: ProgressUpdateSchema,
    errors: {
      400: ["NOT_A_VIDEO", "NOT_TRACKABLE"],
      403: ["ENROLLMENT_REQUIRED", "GUARDIAN_CONSENT_REQUIRED"],
      404: ["CONTENT_ITEM_NOT_FOUND"],
    },
    example: { videoPositionSec: 125 },
  },
  ProgressController_forCourse: {
    id: "getCourseProgress",
    tag: "Progress & Lesson Q&A",
    summary: "Get my progress in a course and where to resume",
    errors: { 403: ["ENROLLMENT_REQUIRED", "GUARDIAN_CONSENT_REQUIRED"] },
  },
  CommentsController_create: {
    id: "createComment",
    tag: "Progress & Lesson Q&A",
    summary: "Ask or answer a question on a content item",
    description: "404 (no reason code) when the content item is not visible to the caller.",
    body: CreateCommentSchema,
    response: CommentItemSchema,
    errors: { 403: ["GUARDIAN_CONSENT_REQUIRED"] },
    example: { body: "Could you explain the second rule again?" },
  },
  CommentsController_list: {
    id: "listComments",
    tag: "Progress & Lesson Q&A",
    summary: "List the questions on a content item",
    query: ListCommentsQuerySchema,
    response: ListCommentsResponseSchema,
    errors: { 403: ["GUARDIAN_CONSENT_REQUIRED"] },
  },
  CommentsController_update: {
    id: "updateComment",
    tag: "Progress & Lesson Q&A",
    summary: "Edit or hide a comment",
    description: "The author edits their own; staff may also hide. 404 and 403 carry no reason code.",
    body: UpdateCommentSchema,
  },
  CommentsController_delete: {
    id: "deleteComment",
    tag: "Progress & Lesson Q&A",
    summary: "Delete a comment",
    description: "The author or staff. 404 and 403 carry no reason code.",
  },

  // ── Notifications & Announcements ───────────────────────────────────────────────────────────
  NotificationsController_list: {
    id: "listNotifications",
    tag: "Notifications & Announcements",
    summary: "List my notifications",
    query: ListNotificationsQuerySchema,
    response: ListNotificationsResponseSchema,
  },
  NotificationsController_markRead: {
    id: "markNotificationsRead",
    tag: "Notifications & Announcements",
    summary: "Mark notifications read",
    body: MarkNotificationsReadSchema,
    response: MarkNotificationsReadResponseSchema,
  },
  SseController_stream: {
    id: "openEventStream",
    tag: "Notifications & Announcements",
    summary: "Open the server-sent event stream",
    description:
      "At most 5 per user. Events: connected, notification.created, device_revoked, session_terminated. " +
      "Closed by the server when the device is revoked or the session ends. Not usable from Try it out.",
  },
  AnnouncementsController_create: {
    id: "createAnnouncement",
    tag: "Notifications & Announcements",
    summary: "Post an announcement to the academy or one course",
    body: CreateAnnouncementSchema,
    response: AnnouncementItemSchema,
    errors: { 404: ["COURSE_NOT_FOUND"] },
    example: { title: "Exam on Friday", body: "The unit 2 quiz opens Friday at 6 pm.", courseId: UUID },
  },
  AnnouncementsController_list: {
    id: "listAnnouncements",
    tag: "Notifications & Announcements",
    summary: "List announcements",
    description: "Students see the academy-wide ones and those of their courses.",
    query: ListAnnouncementsQuerySchema,
    response: ListAnnouncementsResponseSchema,
  },

  // ── Academy Settings & Insights ─────────────────────────────────────────────────────────────
  SettingsController_getPublic: {
    id: "getPublicSettings",
    tag: "Academy Settings & Insights",
    summary: "Get the academy's public branding and pages",
  },
  SettingsController_get: {
    id: "getSettings",
    tag: "Academy Settings & Insights",
    summary: "Get the academy's full settings",
  },
  SettingsController_update: {
    id: "updateSettings",
    tag: "Academy Settings & Insights",
    summary: "Change the academy's settings",
    description: "A part sent replaces that whole part. Page HTML is cleaned on save. Audited.",
    body: TenantSettingsPatchSchema,
    errors: { 400: ["ASSET_NOT_USABLE"] },
    example: { name: "Al-Noor Academy", defaultMaxDevices: 2 },
  },
  AuditController_list: {
    id: "listAuditLogs",
    tag: "Academy Settings & Insights",
    summary: "List audit log entries",
    description: "Filter by actor, action and date. The super admin also sees platform entries.",
    query: AuditLogListQuerySchema,
    response: AuditLogListResponseSchema,
  },
  AnalyticsController_getOverview: {
    id: "getAnalyticsOverview",
    tag: "Academy Settings & Insights",
    summary: "Get the dashboard numbers",
    response: AnalyticsOverviewResponseSchema,
  },
};

/**
 * Better Auth routes (served by Next.js), keyed by path under /api/auth. Paths not listed here
 * are hidden from the docs (`callback/{id}`, `error`); switched-off paths never appear at all.
 */
export const authOperations: Record<string, { summary: string; description: string; who: string }> = {
  "/sign-in/email": {
    summary: "Staff and super admin sign-in",
    description:
      "Email and password; staff passwords are 12+ characters. Students use /sign-in/student. Every staff " +
      "sign-in, success or failure, is audited. 403 `USE_STUDENT_SIGN_IN` for students.",
    who: "Anyone (no session).",
  },
  "/sign-in/student": {
    summary: "Student sign-in with device rules",
    description:
      "Body `{ email, password }`; the academy comes from the Host header. 403 `{ code }`: DEVICE_LIMIT, " +
      "SESSION_ON_OTHER_DEVICE, USER_SUSPENDED, NO_ACCESS, TENANT_PAUSED, USE_STAFF_SIGN_IN, " +
      "EMAIL_NOT_VERIFIED. 5 per minute per IP. Sets the session and device cookies.",
    who: "Anyone (no session), on an academy host.",
  },
  "/sign-out": { summary: "Sign out", description: "Ends this session.", who: "Signed in." },
  "/get-session": {
    summary: "Get the current session",
    description: "The session and user, or null.",
    who: "Anyone; answers null without a session.",
  },
  "/list-sessions": { summary: "List my sessions", description: "All open sessions of this user.", who: "Signed in." },
  "/revoke-session": { summary: "End one of my sessions", description: "By session token.", who: "Signed in." },
  "/revoke-sessions": { summary: "End all my sessions", description: "Including this one.", who: "Signed in." },
  "/revoke-other-sessions": {
    summary: "End my other sessions",
    description: "Keeps this session.",
    who: "Signed in.",
  },
  "/change-password": {
    summary: "Change my password",
    description:
      "Staff need 12+ characters, students 8+. Clears `mustChangePassword` and ends the other sessions.",
    who: "Signed in (allowed while a password change is required).",
  },
  "/request-password-reset": {
    summary: "Email me a password-reset link",
    description: "Sent only to verified addresses; the answer is the same either way.",
    who: "Anyone (no session).",
  },
  "/reset-password/{token}": {
    summary: "Open a password-reset link",
    description: "Redirects to the reset page with the token.",
    who: "Anyone with the emailed link.",
  },
  "/reset-password": {
    summary: "Set a new password with a reset token",
    description: "Same length rules as change-password. Clears `mustChangePassword`.",
    who: "Anyone with the emailed token.",
  },
  "/send-verification-email": {
    summary: "Email me a verification link",
    description: "For an active unverified account only from its own session.",
    who: "Anyone; see description.",
  },
  "/verify-email": {
    summary: "Verify an email address",
    description: "A pending (self-registered) account becomes active.",
    who: "Anyone with the emailed link.",
  },
  "/update-user": { summary: "Update my name or image", description: "Profile fields only.", who: "Signed in." },
  "/ok": { summary: "Check that the auth service answers", description: "Health of Better Auth.", who: "Anyone." },
};
