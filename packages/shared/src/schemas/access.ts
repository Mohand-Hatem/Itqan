export const AccessReasonCode = {
  USER_SUSPENDED: "USER_SUSPENDED",
  NO_ACCESS: "NO_ACCESS",
  TENANT_PAUSED: "TENANT_PAUSED",
  ROLE_FORBIDDEN: "ROLE_FORBIDDEN",
  DEVICE_LIMIT: "DEVICE_LIMIT",
  SESSION_ON_OTHER_DEVICE: "SESSION_ON_OTHER_DEVICE",
  // Per-request device check (step 5.4): the device cookie does not match the session's device.
  DEVICE_NOT_REGISTERED: "DEVICE_NOT_REGISTERED",
  // Sign-in routing (ADR-011): staff use /sign-in/email, students /sign-in/student.
  USE_STAFF_SIGN_IN: "USE_STAFF_SIGN_IN",
  USE_STUDENT_SIGN_IN: "USE_STUDENT_SIGN_IN",
  // Account status `pending` (10R.3): self-registered, the verification link not used yet.
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  // `must_change_password` (10R.3, FR-A08): only GET /me answers until the password is changed.
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  // 10R.7 (FR-A06, ADR-014): a minor without recorded guardian consent cannot open content.
  GUARDIAN_CONSENT_REQUIRED: "GUARDIAN_CONSENT_REQUIRED",
} as const;

export type AccessReasonCode = (typeof AccessReasonCode)[keyof typeof AccessReasonCode];
