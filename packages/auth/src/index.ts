export const AUTH_VERSION = "0.1.0";
export { auth, type Auth, type AuthSession, type AuthUser, type SessionPayload } from "./auth.js";
export {
  DEVICE_COOKIE_MAX_AGE,
  DEVICE_COOKIE_NAME,
  createDeviceSecret,
  deviceCookieOptions,
  formatDeviceCookie,
  hashDeviceSecret,
  parseDeviceCookie,
  readDeviceCookie,
  verifyDeviceSecret,
} from "./device-cookie.js";
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
export { guardStudentSession, studentSignInPlugin } from "./student-sign-in.js";
export {
  checkStudentAccess,
  verifyCredentials,
  type PasswordContext,
  type StudentAccess,
} from "./student-access.js";
