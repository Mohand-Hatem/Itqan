import { describe, expect, it } from "vitest";
import {
  getCourseAccessEmail,
  getDefaultFromEmail,
  getDeviceRequestDecidedEmail,
  getExamOpeningEmail,
  getGradeReleasedEmail,
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

describe("Important Notification Templates", () => {
  describe("grade_released template", () => {
    it("renders Arabic grade released email with score and review link", () => {
      const { subject, html, text } = getGradeReleasedEmail({
        studentName: "عمر الفاروق",
        quizTitle: "اختبار أحكام النون الساكنة",
        courseTitle: "تجويد متقدم",
        score: 95,
        maxScore: 100,
        percentage: 95,
        passed: true,
        reviewUrl: "https://demo.itqan.test/quizzes/q1/review",
        tenantName: "أكاديمية الإتقان",
      });

      expect(subject).toContain("تم رصد درجة اختبار اختبار أحكام النون الساكنة");
      expect(subject).toContain("أكاديمية الإتقان");
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="ar"');
      expect(html).toContain("عمر الفاروق");
      expect(html).toContain("95 من 100");
      expect(html).toContain("ناجح");
      expect(html).toContain("https://demo.itqan.test/quizzes/q1/review");
      expect(text).toContain("https://demo.itqan.test/quizzes/q1/review");
    });

    it("renders English grade released email when locale is en", () => {
      const { subject, html, text } = getGradeReleasedEmail({
        studentName: "Omar",
        quizTitle: "Final Tajweed Exam",
        courseTitle: "Advanced Tajweed",
        score: 40,
        maxScore: 100,
        percentage: 40,
        passed: false,
        reviewUrl: "https://demo.itqan.test/quizzes/q1/review",
        tenantName: "Itqan Academy",
        locale: "en",
      });

      expect(subject).toContain("Grade Released: Final Tajweed Exam");
      expect(subject).toContain("Itqan Academy");
      expect(html).toContain('dir="ltr"');
      expect(html).toContain('lang="en"');
      expect(html).toContain("Omar");
      expect(html).toContain("40/100");
      expect(html).toContain("Did not pass");
      expect(html).toContain("https://demo.itqan.test/quizzes/q1/review");
      expect(text).toContain("https://demo.itqan.test/quizzes/q1/review");
    });

    it("escapes malicious HTML input to prevent XSS", () => {
      const { html } = getGradeReleasedEmail({
        studentName: "<script>alert('xss')</script>",
        quizTitle: 'Quiz "><b onmouseover=alert(1)>Test</b>',
        tenantName: "Tenant & Partners",
      });

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;");
      expect(html).toContain("&quot;&gt;&lt;b");
      expect(html).toContain("Tenant &amp; Partners");
    });
  });

  describe("exam_opening template", () => {
    it("renders Arabic exam opening email with duration and exam URL", () => {
      const { subject, html, text } = getExamOpeningEmail({
        studentName: "زيد",
        quizTitle: "اختبار منتصف الفصل",
        courseTitle: "الفقه الميسر",
        durationMin: 60,
        examUrl: "https://demo.itqan.test/quizzes/q2/take",
        tenantName: "معهد النور",
      });

      expect(subject).toContain("بدء اختبار اختبار منتصف الفصل - معهد النور");
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="ar"');
      expect(html).toContain("زيد");
      expect(html).toContain("60 دقيقة");
      expect(html).toContain("https://demo.itqan.test/quizzes/q2/take");
      expect(text).toContain("https://demo.itqan.test/quizzes/q2/take");
    });

    it("renders English exam opening email when locale is en", () => {
      const { subject, html, text } = getExamOpeningEmail({
        studentName: "Zaid",
        quizTitle: "Midterm Exam",
        courseTitle: "Islamic Jurisprudence",
        durationMin: 45,
        examUrl: "https://demo.itqan.test/quizzes/q2/take",
        tenantName: "Al-Noor Institute",
        locale: "en",
      });

      expect(subject).toContain("Exam Now Open: Midterm Exam - Al-Noor Institute");
      expect(html).toContain('dir="ltr"');
      expect(html).toContain('lang="en"');
      expect(html).toContain("Zaid");
      expect(html).toContain("45 minutes");
      expect(html).toContain("https://demo.itqan.test/quizzes/q2/take");
      expect(text).toContain("https://demo.itqan.test/quizzes/q2/take");
    });
  });

  describe("course_access template", () => {
    it("renders Arabic course access email with course URL", () => {
      const { subject, html, text } = getCourseAccessEmail({
        studentName: "فاطمة",
        courseTitle: "شرح متن الآجرومية",
        courseUrl: "https://demo.itqan.test/courses/c1",
        tenantName: "أكاديمية لسان العرب",
      });

      expect(subject).toContain("تم تفعيل اشتراكك في دورة شرح متن الآجرومية - أكاديمية لسان العرب");
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="ar"');
      expect(html).toContain("فاطمة");
      expect(html).toContain("شرح متن الآجرومية");
      expect(html).toContain("https://demo.itqan.test/courses/c1");
      expect(text).toContain("https://demo.itqan.test/courses/c1");
    });

    it("renders English course access email when locale is en", () => {
      const { subject, html, text } = getCourseAccessEmail({
        studentName: "Fatima",
        courseTitle: "Arabic Grammar Basics",
        courseUrl: "https://demo.itqan.test/courses/c1",
        tenantName: "Arabic Language Academy",
        locale: "en",
      });

      expect(subject).toContain("Course Access Granted: Arabic Grammar Basics - Arabic Language Academy");
      expect(html).toContain('dir="ltr"');
      expect(html).toContain('lang="en"');
      expect(html).toContain("Fatima");
      expect(html).toContain("Arabic Grammar Basics");
      expect(html).toContain("https://demo.itqan.test/courses/c1");
      expect(text).toContain("https://demo.itqan.test/courses/c1");
    });
  });

  describe("device_request_decided template", () => {
    it("renders Arabic approved device change email with login link", () => {
      const { subject, html, text } = getDeviceRequestDecidedEmail({
        studentName: "يوسف",
        status: "approved",
        requestType: "device_change",
        tenantName: "أكاديمية الإتقان",
        loginUrl: "https://demo.itqan.test/login",
      });

      expect(subject).toContain("تمت الموافقة على طلب تغيير الجهاز");
      expect(html).toContain('dir="rtl"');
      expect(html).toContain('lang="ar"');
      expect(html).toContain("يوسف");
      expect(html).toContain("https://demo.itqan.test/login");
      expect(text).toContain("https://demo.itqan.test/login");
    });

    it("renders Arabic rejected sign-out request email", () => {
      const { subject, html } = getDeviceRequestDecidedEmail({
        studentName: "يوسف",
        status: "rejected",
        requestType: "sign_out_other",
        tenantName: "أكاديمية الإتقان",
      });

      expect(subject).toContain("تم رفض طلب تسجيل الخروج من الأجهزة الأخرى");
      expect(html).toContain('dir="rtl"');
      expect(html).toContain("تعذر قبول طلب");
    });

    it("renders English approved and rejected decisions", () => {
      const approved = getDeviceRequestDecidedEmail({
        studentName: "Youssef",
        status: "approved",
        requestType: "device_change",
        tenantName: "Itqan Academy",
        loginUrl: "https://demo.itqan.test/login",
        locale: "en",
      });
      expect(approved.subject).toContain("Device Request Approved: device change");
      expect(approved.html).toContain('dir="ltr"');
      expect(approved.html).toContain("https://demo.itqan.test/login");

      const rejected = getDeviceRequestDecidedEmail({
        studentName: "Youssef",
        status: "rejected",
        requestType: "sign_out_other",
        tenantName: "Itqan Academy",
        locale: "en",
      });
      expect(rejected.subject).toContain("Device Request Rejected: sign out other devices");
      expect(rejected.html).toContain('dir="ltr"');
      expect(rejected.html).toContain("could not be approved");
    });
  });
});

describe("default locale handling (NFR-04 RTL)", () => {
  it("defaults to Arabic (ar) and dir=rtl when locale is omitted across all important types", () => {
    const grade = getGradeReleasedEmail({
      quizTitle: "اختبار",
      tenantName: "مركز",
    });
    expect(grade.html).toContain('dir="rtl"');
    expect(grade.html).toContain('lang="ar"');

    const exam = getExamOpeningEmail({
      quizTitle: "اختبار",
      tenantName: "مركز",
    });
    expect(exam.html).toContain('dir="rtl"');
    expect(exam.html).toContain('lang="ar"');

    const course = getCourseAccessEmail({
      courseTitle: "دورة",
      tenantName: "مركز",
    });
    expect(course.html).toContain('dir="rtl"');
    expect(course.html).toContain('lang="ar"');

    const dev = getDeviceRequestDecidedEmail({
      status: "approved",
      requestType: "device_change",
      tenantName: "مركز",
    });
    expect(dev.html).toContain('dir="rtl"');
    expect(dev.html).toContain('lang="ar"');
  });
});
