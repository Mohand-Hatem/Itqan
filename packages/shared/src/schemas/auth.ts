import { z } from "zod";

/** Body of POST /api/auth/sign-in/student (ADR-011). */
export const StudentSignInBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(256),
});

export type StudentSignInBody = z.infer<typeof StudentSignInBodySchema>;

/** Body of POST /api/device-requests (step 5.6): the student is not signed in, so the password is checked again. */
export const DeviceRequestBodySchema = StudentSignInBodySchema.extend({
  message: z.string().trim().max(500).optional(),
});

export type DeviceRequestBody = z.infer<typeof DeviceRequestBodySchema>;

/** Body of POST /api/signout-requests (step 5.7): same fields as the device request. */
export const SignOutRequestBodySchema = DeviceRequestBodySchema;
export type SignOutRequestBody = DeviceRequestBody;

/** Support request outcomes that are not access problems (409). */
export const SupportRequestReason = {
  DEVICE_REQUEST_NOT_NEEDED: "DEVICE_REQUEST_NOT_NEEDED",
  REQUEST_ALREADY_OPEN: "REQUEST_ALREADY_OPEN",
  SIGN_OUT_REQUEST_NOT_NEEDED: "SIGN_OUT_REQUEST_NOT_NEEDED",
  // Staff decisions (step 5.8a).
  REQUEST_NOT_OPEN: "REQUEST_NOT_OPEN",
  REQUEST_STALE: "REQUEST_STALE",
} as const;

export type SupportRequestReason = (typeof SupportRequestReason)[keyof typeof SupportRequestReason];

/** Query of GET /api/support-requests (step 5.8a): newest first, cursor = last id of the previous page. */
export const SupportRequestListQuerySchema = z.object({
  status: z.enum(["open", "approved", "rejected", "closed"]).optional(),
  type: z.enum(["device_change", "sign_out_other", "general"]).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SupportRequestListQuery = z.infer<typeof SupportRequestListQuerySchema>;

/** Body of PATCH /api/students/:membershipId (step 5.9). maxDevices: teacher and super admin only (FR-D02). */
export const StudentAccessPatchSchema = z
  .object({
    status: z.enum(["active", "suspended"]).optional(),
    maxDevices: z.number().int().min(1).max(10).optional(),
  })
  .strict()
  .refine((body) => body.status !== undefined || body.maxDevices !== undefined, {
    message: "Nothing to change.",
  });

export type StudentAccessPatch = z.infer<typeof StudentAccessPatchSchema>;

/** Response of GET /api/me/devices (step 5.10a): active and pending devices, newest first. */
export type MyDevicesResponse = {
  items: {
    id: string;
    name: string | null;
    userAgent: string | null;
    status: "active" | "pending";
    lastSeenAt: string | null;
    createdAt: string;
    /** The device this session was opened on. */
    current: boolean;
  }[];
};
