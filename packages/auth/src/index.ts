export const AUTH_VERSION = "0.1.0";
export {
  auth,
  DISABLED_AUTH_PATHS,
  type Auth,
  type AuthSession,
  type AuthUser,
  type SessionPayload,
} from "./auth.js";
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
  sendCourseAccessEmail,
  sendDeviceRequestDecidedEmail,
  sendEmail,
  sendExamOpeningEmail,
  sendGradeReleasedEmail,
  sendGuardianConsentEmail,
  sendInvitationEmail,
  sendResetPasswordEmail,
  sendTestEmail,
  sendVerificationEmail,
  testMailbox,
  type SentEmailRecord,
} from "./email/client.js";
export {
  type CourseAccessEmailParams,
  type DeviceRequestDecidedEmailParams,
  type EmailLocale,
  type EmailTemplateParams,
  type ExamOpeningEmailParams,
  type GradeReleasedEmailParams,
  type GuardianConsentEmailParams,
  getCourseAccessEmail,
  getDeviceRequestDecidedEmail,
  getExamOpeningEmail,
  getGradeReleasedEmail,
  getGuardianConsentEmail,
  getInvitationEmail,
  getResetPasswordEmail,
  getVerificationEmail,
  type InvitationEmailParams,
} from "./email/templates.js";
export { accountPolicyPlugin, requiredPasswordLength } from "./account-policy.js";
export { isStaffOrSuperAdmin } from "./staff.js";
export { guardNewSession, studentSignInPlugin } from "./student-sign-in.js";
export {
  checkStudentAccess,
  verifyCredentials,
  type PasswordContext,
  type StudentAccess,
} from "./student-access.js";
export {
  BootstrapError,
  bootstrapSuperAdmin,
  createSuperAdminIn,
  recoverSuperAdmin,
} from "./bootstrap.js";
export { DEV_ACCOUNTS, seedDevAccounts } from "./dev-seed.js";
