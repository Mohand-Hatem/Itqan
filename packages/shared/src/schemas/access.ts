export const AccessReasonCode = {
  USER_SUSPENDED: "USER_SUSPENDED",
  NO_ACCESS: "NO_ACCESS",
  TENANT_PAUSED: "TENANT_PAUSED",
  ROLE_FORBIDDEN: "ROLE_FORBIDDEN",
  DEVICE_LIMIT: "DEVICE_LIMIT",
  SESSION_ON_OTHER_DEVICE: "SESSION_ON_OTHER_DEVICE",
  // Per-request device check (step 5.4): the device cookie does not match the session's device.
  DEVICE_NOT_REGISTERED: "DEVICE_NOT_REGISTERED",
  // Sign-in routing (ADR-011): staff use /sign-in/email with TOTP, students /sign-in/student.
  USE_STAFF_SIGN_IN: "USE_STAFF_SIGN_IN",
  USE_STUDENT_SIGN_IN: "USE_STUDENT_SIGN_IN",
} as const;

export type AccessReasonCode = (typeof AccessReasonCode)[keyof typeof AccessReasonCode];
