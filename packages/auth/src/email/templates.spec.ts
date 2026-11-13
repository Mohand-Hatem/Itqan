import { describe, expect, it } from "vitest";
import {
  getDefaultFromEmail,
  getInvitationEmail,
  getResetPasswordEmail,
  getVerificationEmail,
} from "../index.js";

describe("Email Templates (Arabic and English)", () => {
  it("generates Arabic verification email by default", () => {
    const { subject, html, text } = getVerificationEmail({
      url: "https://demo.localhost:8080/verify?token=123",
      name: "أحمد",
    });

    expect(subject).toContain("تأكيد بريدك الإلكتروني");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("أحمد");
    expect(html).toContain("https://demo.localhost:8080/verify?token=123");
    expect(text).toContain("https://demo.localhost:8080/verify?token=123");
  });

  it("generates English verification email when locale is en", () => {
    const { subject, html, text } = getVerificationEmail({
      url: "https://demo.localhost:8080/verify?token=123",
      name: "Ahmed",
      locale: "en",
    });

    expect(subject).toContain("Verify your email");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('lang="en"');
    expect(html).toContain("Ahmed");
    expect(html).toContain("https://demo.localhost:8080/verify?token=123");
    expect(text).toContain("https://demo.localhost:8080/verify?token=123");
  });

  it("generates Arabic password reset email by default", () => {
    const { subject, html, text } = getResetPasswordEmail({
      url: "https://demo.localhost:8080/reset-password?token=456",
      name: "سارة",
    });

    expect(subject).toContain("إعادة تعيين كلمة المرور");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("سارة");
    expect(html).toContain("https://demo.localhost:8080/reset-password?token=456");
    expect(text).toContain("https://demo.localhost:8080/reset-password?token=456");
  });

  it("generates English password reset email when locale is en", () => {
    const { subject, html, text } = getResetPasswordEmail({
      url: "https://demo.localhost:8080/reset-password?token=456",
      name: "Sarah",
      locale: "en",
    });

    expect(subject).toContain("Reset your password");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('lang="en"');
    expect(html).toContain("Sarah");
    expect(html).toContain("https://demo.localhost:8080/reset-password?token=456");
    expect(text).toContain("https://demo.localhost:8080/reset-password?token=456");
  });

  it("provides default test sender onboarding@resend.dev", () => {
    expect(getDefaultFromEmail()).toBe("onboarding@resend.dev");
  });

  it("generates Arabic invitation email by default with course titles", () => {
    const { subject, html, text } = getInvitationEmail({
      url: "https://demo.localhost:8080/join?token=789",
      tenantName: "أكاديمية الإتقان",
      courseTitles: ["تجويد القرآن", "الفقه الميسر"],
    });

    expect(subject).toContain("دعوة للانضمام");
    expect(subject).toContain("أكاديمية الإتقان");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain("تجويد القرآن");
    expect(html).toContain("الفقه الميسر");
    expect(html).toContain("https://demo.localhost:8080/join?token=789");
    expect(text).toContain("https://demo.localhost:8080/join?token=789");
  });

  it("generates English invitation email when requested", () => {
    const { subject, html, text } = getInvitationEmail({
      url: "https://demo.localhost:8080/join?token=789",
      tenantName: "Itqan Academy",
      courseTitles: ["Quran Tajweed"],
      locale: "en",
    });

    expect(subject).toContain("Invitation to join Itqan Academy");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('lang="en"');
    expect(html).toContain("Quran Tajweed");
    expect(html).toContain("https://demo.localhost:8080/join?token=789");
    expect(text).toContain("https://demo.localhost:8080/join?token=789");
  });
});
