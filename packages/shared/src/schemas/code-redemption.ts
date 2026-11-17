import { z } from "zod";
import { GuardianInfoSchema } from "./guardian-consent.js";

export const CodeRegisterSchema = z
  .object({
    code: z.string().min(1, "Access code is required"),
    name: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name cannot exceed 100 characters"),
    email: z.string().trim().email("Invalid email address").toLowerCase(),
    password: z.string().min(8, "Password must be at least 8 characters").max(100),
    phone: z.string().trim().optional(),
    // 10R.7 (FR-A06): a minor registers, then content waits for the guardian's consent.
    isMinor: z.boolean().default(false),
    /** Optional: the guardian gets the consent email at once. */
    guardian: GuardianInfoSchema.optional(),
  })
  .refine((data) => data.isMinor || !data.guardian, {
    message: "A guardian is named only for a student under 18.",
    path: ["guardian"],
  });

export type CodeRegisterInput = z.infer<typeof CodeRegisterSchema>;

export const CodeRedeemSchema = z.object({
  code: z.string().min(1, "Access code is required"),
});

export type CodeRedeemInput = z.infer<typeof CodeRedeemSchema>;
