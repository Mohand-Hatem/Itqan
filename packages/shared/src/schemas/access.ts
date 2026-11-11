export const AccessReasonCode = {
  USER_SUSPENDED: "USER_SUSPENDED",
  NO_ACCESS: "NO_ACCESS",
  TENANT_PAUSED: "TENANT_PAUSED",
  ROLE_FORBIDDEN: "ROLE_FORBIDDEN",
  DEVICE_LIMIT: "DEVICE_LIMIT",
  SESSION_ON_OTHER_DEVICE: "SESSION_ON_OTHER_DEVICE",
} as const;

export type AccessReasonCode =
  (typeof AccessReasonCode)[keyof typeof AccessReasonCode];
