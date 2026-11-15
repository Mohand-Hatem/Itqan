import type { CreateNotificationInput } from "./notifications.service.js";

/**
 * The FR-N03 "important" notifications: stored for the bell, pushed over SSE, and emailed.
 * The UI renders text from `type` and `data`; title and body are a plain fallback.
 */

export const gradeReleasedNotification = (
  userId: string,
  quiz: { id: string; title: string },
): CreateNotificationInput => ({
  userId,
  type: "grade_released",
  title: quiz.title,
  body: "Your grade is available.",
  data: { quizId: quiz.id, quizTitle: quiz.title },
  sendEmail: true,
});

export const courseAccessNotification = (
  userId: string,
  course: { id: string; title: string; tenantId: string },
): CreateNotificationInput => ({
  tenantId: course.tenantId,
  userId,
  type: "course_access",
  title: course.title,
  body: "You now have access to this course.",
  data: { courseId: course.id, courseTitle: course.title },
  sendEmail: true,
});

export const deviceRequestDecidedNotification = (
  userId: string,
  request: {
    id: string;
    type: "device_change" | "sign_out_other";
    status: "approved" | "rejected";
  },
): CreateNotificationInput => ({
  userId,
  type: "device_request_decided",
  title: request.status === "approved" ? "Request approved" : "Request rejected",
  body: "Your device request has been decided.",
  data: { requestId: request.id, requestType: request.type, status: request.status },
  sendEmail: true,
});
