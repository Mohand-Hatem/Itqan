export const AUTH_VERSION = "0.1.0";
export {
  auth,
  type Auth,
  type AuthSession,
  type AuthUser,
  type SessionPayload,
} from "./auth.js";
export {
  clearTestMailbox,
  getDefaultFromEmail,
  getLastSentEmail,
  getResendClient,
  sendEmail,
  sendResetPasswordEmail,
  sendTestEmail,
  sendVerificationEmail,
  testMailbox,
  type SentEmailRecord,
} from "./email/client.js";
export {
  type EmailLocale,
  type EmailTemplateParams,
  getResetPasswordEmail,
  getVerificationEmail,
} from "./email/templates.js";
export {
  MFA_ENROLMENT_REQUIRED_REASON,
  checkStaffMfaRequirement,
  isStaffOrSuperAdmin,
  staffMfaPlugin,
  type MfaStatus,
} from "./staff-mfa.js";
