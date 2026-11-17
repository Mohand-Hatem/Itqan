import { randomUUID } from "node:crypto";
import process from "node:process";
import { Resend } from "resend";
import {
  type CourseAccessEmailParams,
  type DeviceRequestDecidedEmailParams,
  type EmailLocale,
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
} from "./templates.js";

export interface SentEmailRecord {
  to: string;
  subject: string;
  html: string;
  text?: string;
  url?: string;
  token?: string;
  type:
    | "verification"
    | "reset"
    | "invitation"
    | "grade_released"
    | "exam_opening"
    | "course_access"
    | "device_request_decided"
    | "guardian_consent"
    | "other";
  /** The Resend idempotency key the send used (10R.6), so tests can check it. */
  idempotencyKey?: string;
  sentAt: Date;
}

export const testMailbox: SentEmailRecord[] = [];

export function clearTestMailbox(): void {
  testMailbox.length = 0;
}

export function getLastSentEmail(to?: string): SentEmailRecord | undefined {
  if (!to) return testMailbox[testMailbox.length - 1];
  for (let i = testMailbox.length - 1; i >= 0; i--) {
    const item = testMailbox[i];
    if (item && item.to.toLowerCase() === to.toLowerCase()) {
      return item;
    }
  }
  return undefined;
}

function extractTokenFromUrl(rawUrl: string): string | undefined {
  try {
    const u = new URL(rawUrl);
    return u.searchParams.get("token") ?? undefined;
  } catch {
    return undefined;
  }
}

export function getResendClient(): Resend | null {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export function getDefaultFromEmail(): string {
  return process.env["RESEND_FROM_EMAIL"] || "onboarding@resend.dev";
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /**
   * Same key = Resend sends once (for 24 hours), so a retried request never mails twice. Use one
   * key per logical message, e.g. `invitation:<id>:<token hash prefix>` (10R.6).
   */
  idempotencyKey?: string;
}): Promise<{ id?: string; error?: string }> {
  // In automated test environments without explicit live dispatch flag, use the in-memory test mailbox
  if (process.env["NODE_ENV"] === "test" && process.env["RESEND_ENABLE_IN_TEST"] !== "true") {
    const mockId = `mock-email-${randomUUID()}`;
    return { id: mockId };
  }

  const resend = getResendClient();
  if (!resend) {
    return { error: "RESEND_API_KEY is not configured" };
  }

  const from = getDefaultFromEmail();
  const { data, error } = await resend.emails.send(
    {
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    },
    options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
  );

  if (error) {
    return { error: error.message };
  }

  return { id: data?.id };
}

export async function sendVerificationEmail(options: {
  to: string;
  url: string;
  name?: string;
  locale?: EmailLocale;
  token?: string;
}): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getVerificationEmail(options);
  const token = options.token ?? extractTokenFromUrl(options.url);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.url,
      token,
      type: "verification",
      sentAt: new Date(),
    });
  }

  return sendEmail({ to: options.to, subject, html, text });
}

export async function sendResetPasswordEmail(options: {
  to: string;
  url: string;
  name?: string;
  locale?: EmailLocale;
  token?: string;
}): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getResetPasswordEmail(options);
  const token = options.token ?? extractTokenFromUrl(options.url);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.url,
      token,
      type: "reset",
      sentAt: new Date(),
    });
  }

  return sendEmail({ to: options.to, subject, html, text });
}

export async function sendInvitationEmail(options: {
  to: string;
  url: string;
  tenantName: string;
  courseTitles?: string[];
  locale?: EmailLocale;
  token?: string;
  role?: "teacher" | "assistant" | "student";
  idempotencyKey?: string;
}): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getInvitationEmail(options);
  const token = options.token ?? extractTokenFromUrl(options.url);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.url,
      token,
      type: "invitation",
      idempotencyKey: options.idempotencyKey,
      sentAt: new Date(),
    });
  }

  return sendEmail({
    to: options.to,
    subject,
    html,
    text,
    idempotencyKey: options.idempotencyKey,
  });
}

/** 10R.7: one Resend key per (consent, token), so a retried request mails once. */
export async function sendGuardianConsentEmail(
  options: GuardianConsentEmailParams & { to: string; idempotencyKey?: string },
): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getGuardianConsentEmail(options);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.url,
      token: extractTokenFromUrl(options.url),
      type: "guardian_consent",
      idempotencyKey: options.idempotencyKey,
      sentAt: new Date(),
    });
  }

  return sendEmail({ to: options.to, subject, html, text, idempotencyKey: options.idempotencyKey });
}

export async function sendGradeReleasedEmail(
  options: GradeReleasedEmailParams & { to: string },
): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getGradeReleasedEmail(options);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.reviewUrl,
      type: "grade_released",
      sentAt: new Date(),
    });
  }

  return sendEmail({ to: options.to, subject, html, text });
}

export async function sendExamOpeningEmail(
  options: ExamOpeningEmailParams & { to: string },
): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getExamOpeningEmail(options);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.examUrl,
      type: "exam_opening",
      sentAt: new Date(),
    });
  }

  return sendEmail({ to: options.to, subject, html, text });
}

export async function sendCourseAccessEmail(
  options: CourseAccessEmailParams & { to: string },
): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getCourseAccessEmail(options);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.courseUrl,
      type: "course_access",
      sentAt: new Date(),
    });
  }

  return sendEmail({ to: options.to, subject, html, text });
}

export async function sendDeviceRequestDecidedEmail(
  options: DeviceRequestDecidedEmailParams & { to: string },
): Promise<{ id?: string; error?: string }> {
  const { subject, html, text } = getDeviceRequestDecidedEmail(options);

  if (process.env["NODE_ENV"] === "test") {
    testMailbox.push({
      to: options.to,
      subject,
      html,
      text,
      url: options.loginUrl,
      type: "device_request_decided",
      sentAt: new Date(),
    });
  }

  return sendEmail({ to: options.to, subject, html, text });
}

export async function sendTestEmail(to: string): Promise<{ id?: string; error?: string }> {
  return sendEmail({
    to,
    subject: "رسالة تجريبية من منصة إتقان / Test Email from Itqan",
    text: "هذه رسالة تجريبية لتأكيد إعداد خدمة البريد Resend في منصة إتقان.\n\nThis is a test email verifying Resend configuration for Itqan platform.",
    html: `
      <div dir="rtl" style="font-family: sans-serif; padding: 20px; line-height: 1.6;">
        <h2>منصة إتقان - رسالة اختبار / Test Message</h2>
        <p>تم استلام هذه الرسالة بنجاح عبر خدمة Resend للتحقق من إعدادات البريد الإلكتروني.</p>
        <p>This message confirms that your Resend integration is successfully wired and working.</p>
      </div>
    `,
  });
}
