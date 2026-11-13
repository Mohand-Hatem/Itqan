import { z } from "zod";

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
    isMinor: z.boolean().default(false),
    guardianConsent: z.boolean().default(false),
  })
  .refine((data) => !data.isMinor || data.guardianConsent, {
    message: "Guardian consent is required for students under 18.",
    path: ["guardianConsent"],
  });

export type CodeRegisterInput = z.infer<typeof CodeRegisterSchema>;

export const CodeRedeemSchema = z.object({
  code: z.string().min(1, "Access code is required"),
});

export type CodeRedeemInput = z.infer<typeof CodeRedeemSchema>;
