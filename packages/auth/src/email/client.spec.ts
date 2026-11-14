import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTestMailbox,
  getLastSentEmail,
  sendCourseAccessEmail,
  sendDeviceRequestDecidedEmail,
  sendExamOpeningEmail,
  sendGradeReleasedEmail,
  testMailbox,
} from "./client.js";

describe("Email Client Handlers (Gate G2)", () => {
  beforeEach(() => {
    clearTestMailbox();
  });

  it("sendGradeReleasedEmail records in testMailbox with type grade_released", async () => {
    const res = await sendGradeReleasedEmail({
      to: "student@example.com",
      studentName: "عبدالله",
      quizTitle: "اختبار الفقه",
      courseTitle: "الفقه الميسر",
      score: 88,
      maxScore: 100,
      percentage: 88,
      passed: true,
      reviewUrl: "https://demo.itqan.test/review/1",
      tenantName: "أكاديمية الإتقان",
      locale: "ar",
    });

    expect(res.id).toBeDefined();
    expect(testMailbox.length).toBe(1);

    const record = getLastSentEmail("student@example.com");
    expect(record).toBeDefined();
    expect(record?.type).toBe("grade_released");
    expect(record?.to).toBe("student@example.com");
    expect(record?.subject).toContain("تم رصد درجة اختبار اختبار الفقه");
    expect(record?.url).toBe("https://demo.itqan.test/review/1");
    expect(record?.html).toContain("88 من 100");
  });

  it("sendExamOpeningEmail records in testMailbox with type exam_opening", async () => {
    const res = await sendExamOpeningEmail({
      to: "student2@example.com",
      studentName: "خالد",
      quizTitle: "اختبار التجويد النهائي",
      durationMin: 90,
      examUrl: "https://demo.itqan.test/quizzes/q1/take",
      tenantName: "معهد الفرقان",
      locale: "ar",
    });

    expect(res.id).toBeDefined();
    expect(testMailbox.length).toBe(1);

    const record = getLastSentEmail();
    expect(record?.type).toBe("exam_opening");
    expect(record?.to).toBe("student2@example.com");
    expect(record?.subject).toContain("بدء اختبار اختبار التجويد النهائي");
    expect(record?.url).toBe("https://demo.itqan.test/quizzes/q1/take");
    expect(record?.html).toContain("90 دقيقة");
  });

  it("sendCourseAccessEmail records in testMailbox with type course_access", async () => {
    const res = await sendCourseAccessEmail({
      to: "student3@example.com",
      studentName: "Layla",
      courseTitle: "Advanced Tajweed",
      courseUrl: "https://demo.itqan.test/courses/tajweed",
      tenantName: "Itqan Academy",
      locale: "en",
    });

    expect(res.id).toBeDefined();
    expect(testMailbox.length).toBe(1);

    const record = getLastSentEmail("student3@example.com");
    expect(record?.type).toBe("course_access");
    expect(record?.subject).toContain("Course Access Granted: Advanced Tajweed");
    expect(record?.url).toBe("https://demo.itqan.test/courses/tajweed");
    expect(record?.html).toContain("Layla");
  });

  it("sendDeviceRequestDecidedEmail records in testMailbox with type device_request_decided", async () => {
    const res = await sendDeviceRequestDecidedEmail({
      to: "student4@example.com",
      studentName: "مريم",
      status: "approved",
      requestType: "device_change",
      tenantName: "أكاديمية الإتقان",
      loginUrl: "https://demo.itqan.test/login",
      locale: "ar",
    });

    expect(res.id).toBeDefined();
    expect(testMailbox.length).toBe(1);

    const record = getLastSentEmail("student4@example.com");
    expect(record?.type).toBe("device_request_decided");
    expect(record?.subject).toContain("تمت الموافقة على طلب تغيير الجهاز");
    expect(record?.url).toBe("https://demo.itqan.test/login");
    expect(record?.html).toContain("تمت الموافقة");
  });

  it("clearTestMailbox empties testMailbox correctly", () => {
    testMailbox.push({
      to: "temp@example.com",
      subject: "test",
      html: "<p>test</p>",
      type: "other",
      sentAt: new Date(),
    });
    expect(testMailbox.length).toBe(1);

    clearTestMailbox();
    expect(testMailbox.length).toBe(0);
    expect(getLastSentEmail()).toBeUndefined();
  });
});
