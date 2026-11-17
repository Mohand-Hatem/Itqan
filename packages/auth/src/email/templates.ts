export type EmailLocale = "ar" | "en";

export interface EmailTemplateParams {
  url: string;
  name?: string;
  locale?: EmailLocale;
}

export function getVerificationEmail(params: EmailTemplateParams) {
  const isArabic = params.locale !== "en";
  const name = params.name ?? (isArabic ? "مستخدم إتقان" : "Itqan User");

  if (isArabic) {
    return {
      subject: "تأكيد بريدك الإلكتروني - منصة إتقان",
      text: `مرحباً ${name}،\n\nشكراً لتسجيلك في منصة إتقان. يرجى تأكيد بريدك الإلكتروني عبر الرابط التالي:\n${params.url}\n\nهذا الرابط صالح للاستخدام المؤقت.\nإذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>مرحباً ${escapeHtml(name)}،</h1>
            <p>شكراً لتسجيلك في منصة <strong>إتقان</strong>. لتفعيل حسابك والمتابعة، يرجى تأكيد عنوان بريدك الإلكتروني بالنقر على الزر أدناه:</p>
            <p><a href="${params.url}" class="btn">تأكيد البريد الإلكتروني</a></p>
            <p>أو يمكنك نسخ الرابط التالي ولصقه في متصفحك مباشرة:</p>
            <p class="raw-link">${params.url}</p>
            <div class="footer">
              <p>إذا لم تكن قد طلبت إنشاء حساب في منصة إتقان، يمكنك تجاهل هذه الرسالة بكل أمان.</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: "Verify your email - Itqan Platform",
    text: `Hello ${name},\n\nThank you for signing up for Itqan. Please verify your email address by visiting this link:\n${params.url}\n\nIf you did not create this account, you can safely ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
          h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
          p { font-size: 15px; line-height: 1.6; color: #374151; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
          .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          .raw-link { word-break: break-all; color: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Hello ${escapeHtml(name)},</h1>
          <p>Thank you for signing up for <strong>Itqan</strong>. Please confirm your email address by clicking the button below:</p>
          <p><a href="${params.url}" class="btn">Verify Email Address</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p class="raw-link">${params.url}</p>
          <div class="footer">
            <p>If you didn't create an account with Itqan, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

export function getResetPasswordEmail(params: EmailTemplateParams) {
  const isArabic = params.locale !== "en";
  const name = params.name ?? (isArabic ? "مستخدم إتقان" : "Itqan User");

  if (isArabic) {
    return {
      subject: "إعادة تعيين كلمة المرور - منصة إتقان",
      text: `مرحباً ${name}،\n\nلقد تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في منصة إتقان. يمكنك تعيين كلمة مرور جديدة من خلال الرابط التالي:\n${params.url}\n\nهذا الرابط صالح لمدة ساعة واحدة.\nإذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة وستظل كلمة مرورك الحالية آمنة.`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>مرحباً ${escapeHtml(name)}،</h1>
            <p>تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك على منصة <strong>إتقان</strong>. لإعادة تعيين كلمة المرور، اضغط على الزر التالي:</p>
            <p><a href="${params.url}" class="btn">إعادة تعيين كلمة المرور</a></p>
            <p>أو يمكنك نسخ الرابط التالي ولصقه في متصفحك:</p>
            <p class="raw-link">${params.url}</p>
            <div class="footer">
              <p>هذا الرابط صالح للاستخدام لمرة واحدة ولفترة محدودة. إذا لم تكن قد طلبت ذلك، يمكنك تجاهل هذه الرسالة ولن يتم إجراء أي تغيير على حسابك.</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: "Reset your password - Itqan Platform",
    text: `Hello ${name},\n\nWe received a request to reset your password for your Itqan account. You can reset it using the following link:\n${params.url}\n\nIf you did not request a password reset, you can safely ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
          h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
          p { font-size: 15px; line-height: 1.6; color: #374151; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
          .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          .raw-link { word-break: break-all; color: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Hello ${escapeHtml(name)},</h1>
          <p>We received a request to reset the password for your <strong>Itqan</strong> account. Click the button below to reset it:</p>
          <p><a href="${params.url}" class="btn">Reset Password</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p class="raw-link">${params.url}</p>
          <div class="footer">
            <p>This link will expire soon. If you didn't request a password reset, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

export interface InvitationEmailParams {
  url: string;
  tenantName: string;
  /** The role the invitation gives (10R.6); student when absent. */
  role?: "teacher" | "assistant" | "student";
  courseTitles?: string[];
  locale?: EmailLocale;
}

export function getInvitationEmail(params: InvitationEmailParams) {
  const isArabic = params.locale !== "en";
  const role = params.role ?? "student";
  const roleAr = { teacher: "معلّماً", assistant: "مساعداً", student: "طالباً" }[role];
  const roleEn = { teacher: "a teacher", assistant: "an assistant", student: "a student" }[role];
  const existingAr =
    "إذا كان لديك حساب في إتقان بهذا البريد، فسجّل الدخول به واقبل الدعوة؛ لن تتغير كلمة مرورك.";
  const existingEn =
    "If you already have an Itqan account with this email, sign in with it and accept; your password does not change.";
  const coursesTextAr =
    params.courseTitles && params.courseTitles.length > 0
      ? `للدورات التالية:\n- ${params.courseTitles.join("\n- ")}\n\n`
      : "";
  const coursesHtmlAr =
    params.courseTitles && params.courseTitles.length > 0
      ? `<p>للدورات التدريبية التالية:</p><ul>${params.courseTitles.map((t) => `<li><strong>${escapeHtml(t)}</strong></li>`).join("")}</ul>`
      : "";

  const coursesTextEn =
    params.courseTitles && params.courseTitles.length > 0
      ? `for the following courses:\n- ${params.courseTitles.join("\n- ")}\n\n`
      : "";
  const coursesHtmlEn =
    params.courseTitles && params.courseTitles.length > 0
      ? `<p>for the following courses:</p><ul>${params.courseTitles.map((t) => `<li><strong>${escapeHtml(t)}</strong></li>`).join("")}</ul>`
      : "";

  if (isArabic) {
    return {
      subject: `دعوة للانضمام إلى ${params.tenantName} - منصة إتقان`,
      text: `مرحباً،\n\nلقد تمت دعوتك للانضمام ${roleAr} إلى أكاديمية ${params.tenantName} على منصة إتقان ${coursesTextAr}يرجى استخدام الرابط التالي لإتمام انضمامك:\n${params.url}\n\nهذا الرابط صالح للاستخدام مرة واحدة ولمدة 72 ساعة.\n${existingAr}\nإذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            ul { padding-right: 20px; color: #374151; font-size: 15px; line-height: 1.6; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>دعوة للانضمام إلى ${escapeHtml(params.tenantName)}</h1>
            <p>تمت دعوتك للانضمام ${roleAr} إلى <strong>${escapeHtml(params.tenantName)}</strong> على منصة إتقان.</p>
            ${coursesHtmlAr}
            <p><a href="${params.url}" class="btn">قبول الدعوة والتسجيل</a></p>
            <p>أو يمكنك نسخ الرابط التالي ولصقه في متصفحك مباشرة:</p>
            <p class="raw-link">${params.url}</p>
            <div class="footer">
              <p>هذا الرابط صالح للاستخدام مرة واحدة ولمدة 72 ساعة. ${existingAr}</p>
              <p>إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهلها بأمان.</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: `Invitation to join ${params.tenantName} - Itqan Platform`,
    text: `Hello,\n\nYou have been invited to join ${params.tenantName} as ${roleEn} on Itqan Platform ${coursesTextEn}Please use the following link to complete your registration:\n${params.url}\n\nThis single-use link expires in 72 hours.\n${existingEn}\nIf you did not expect this invitation, you can safely ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
          h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
          p { font-size: 15px; line-height: 1.6; color: #374151; }
          ul { padding-left: 20px; color: #374151; font-size: 15px; line-height: 1.6; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
          .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          .raw-link { word-break: break-all; color: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Invitation to join ${escapeHtml(params.tenantName)}</h1>
          <p>You have been invited to join <strong>${escapeHtml(params.tenantName)}</strong> as ${roleEn} on the Itqan Platform.</p>
          ${coursesHtmlEn}
          <p><a href="${params.url}" class="btn">Accept Invitation & Register</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p class="raw-link">${params.url}</p>
          <div class="footer">
            <p>This single-use link expires in 72 hours. ${existingEn}</p>
            <p>If you did not expect this invitation, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface GradeReleasedEmailParams {
  studentName?: string;
  quizTitle: string;
  courseTitle?: string;
  score?: number | null;
  maxScore?: number | null;
  percentage?: number | null;
  passed?: boolean | null;
  reviewUrl?: string;
  tenantName: string;
  locale?: EmailLocale;
}

export function getGradeReleasedEmail(params: GradeReleasedEmailParams) {
  const isArabic = params.locale !== "en";
  const name = params.studentName ? escapeHtml(params.studentName) : isArabic ? "عزيزي الطالب" : "Dear Student";
  const safeQuiz = escapeHtml(params.quizTitle);
  const safeTenant = escapeHtml(params.tenantName);
  const safeCourse = params.courseTitle ? escapeHtml(params.courseTitle) : undefined;
  const courseTextAr = safeCourse ? ` في دورة "${safeCourse}"` : "";
  const courseTextEn = safeCourse ? ` for the course "${safeCourse}"` : "";

  let scoreDetailsAr = "";
  let scoreDetailsEn = "";
  if (params.score !== null && params.score !== undefined && params.maxScore !== null && params.maxScore !== undefined) {
    const statusAr = params.passed === true ? "ناجح" : params.passed === false ? "غير مجتاز" : "";
    const statusEn = params.passed === true ? "Passed" : params.passed === false ? "Did not pass" : "";
    scoreDetailsAr = `درجتك: ${params.score} من ${params.maxScore}${params.percentage !== null && params.percentage !== undefined ? ` (${params.percentage}%)` : ""}${statusAr ? ` - ${statusAr}` : ""}\n`;
    scoreDetailsEn = `Your score: ${params.score}/${params.maxScore}${params.percentage !== null && params.percentage !== undefined ? ` (${params.percentage}%)` : ""}${statusEn ? ` - ${statusEn}` : ""}\n`;
  }

  const reviewBtnAr = params.reviewUrl
    ? `<p><a href="${params.reviewUrl}" class="btn">عرض نتيجة الاختبار</a></p><p class="raw-link">${params.reviewUrl}</p>`
    : "";
  const reviewBtnEn = params.reviewUrl
    ? `<p><a href="${params.reviewUrl}" class="btn">View Exam Results</a></p><p class="raw-link">${params.reviewUrl}</p>`
    : "";

  if (isArabic) {
    return {
      subject: `تم رصد درجة اختبار ${safeQuiz} - ${safeTenant}`,
      text: `مرحباً ${name}،\n\nنود إعلامك بأنه تم رصد نتيجة اختبار "${safeQuiz}"${courseTextAr}.\n${scoreDetailsAr}${params.reviewUrl ? `يمكنك الاطلاع على تفاصيل النتيجة من خلال الرابط التالي:\n${params.reviewUrl}\n` : ""}\nمع أطيب تمنياتنا لك بالتوفيق والنجاح،\n${safeTenant}`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            .score-box { background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin: 16px 0; font-size: 16px; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>تم رصد درجة الاختبار</h1>
            <p>مرحباً ${name}،</p>
            <p>نود إعلامك بأنه تم نشر درجات اختبار <strong>${safeQuiz}</strong>${courseTextAr}.</p>
            ${scoreDetailsAr ? `<div class="score-box"><strong>${scoreDetailsAr.trim()}</strong></div>` : ""}
            ${reviewBtnAr}
            <div class="footer">
              <p>منصة إتقان - ${safeTenant}</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: `Grade Released: ${safeQuiz} - ${safeTenant}`,
    text: `Hello ${name},\n\nYour grade for the exam "${safeQuiz}"${courseTextEn} has been released.\n${scoreDetailsEn}${params.reviewUrl ? `You can review your result by visiting:\n${params.reviewUrl}\n` : ""}\nBest regards,\n${safeTenant}`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
          h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
          p { font-size: 15px; line-height: 1.6; color: #374151; }
          .score-box { background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin: 16px 0; font-size: 16px; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
          .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          .raw-link { word-break: break-all; color: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Grade Released</h1>
          <p>Hello ${name},</p>
          <p>Your grade for the exam <strong>${safeQuiz}</strong>${courseTextEn} is now available.</p>
          ${scoreDetailsEn ? `<div class="score-box"><strong>${scoreDetailsEn.trim()}</strong></div>` : ""}
          ${reviewBtnEn}
          <div class="footer">
            <p>Itqan Platform - ${safeTenant}</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

export interface ExamOpeningEmailParams {
  studentName?: string;
  quizTitle: string;
  courseTitle?: string;
  opensAt?: Date | string;
  closesAt?: Date | string;
  durationMin?: number;
  examUrl?: string;
  tenantName: string;
  locale?: EmailLocale;
}

export function getExamOpeningEmail(params: ExamOpeningEmailParams) {
  const isArabic = params.locale !== "en";
  const name = params.studentName ? escapeHtml(params.studentName) : isArabic ? "عزيزي الطالب" : "Dear Student";
  const safeQuiz = escapeHtml(params.quizTitle);
  const safeTenant = escapeHtml(params.tenantName);
  const safeCourse = params.courseTitle ? escapeHtml(params.courseTitle) : undefined;
  const courseTextAr = safeCourse ? ` في دورة "${safeCourse}"` : "";
  const courseTextEn = safeCourse ? ` for the course "${safeCourse}"` : "";

  const durationAr = params.durationMin ? `مدة الاختبار: ${params.durationMin} دقيقة.` : "";
  const durationEn = params.durationMin ? `Exam duration: ${params.durationMin} minutes.` : "";

  const examBtnAr = params.examUrl
    ? `<p><a href="${params.examUrl}" class="btn">بدء الاختبار الآن</a></p><p class="raw-link">${params.examUrl}</p>`
    : "";
  const examBtnEn = params.examUrl
    ? `<p><a href="${params.examUrl}" class="btn">Start Exam Now</a></p><p class="raw-link">${params.examUrl}</p>`
    : "";

  if (isArabic) {
    return {
      subject: `بدء اختبار ${safeQuiz} - ${safeTenant}`,
      text: `مرحباً ${name}،\n\nنود تذكيرك بأن اختبار "${safeQuiz}"${courseTextAr} أصبح متاحاً الآن.\n${durationAr ? `${durationAr}\n` : ""}${params.examUrl ? `يمكنك بدء الاختبار عبر الرابط التالي:\n${params.examUrl}\n` : ""}\nمع تمنياتنا لك بالتوفيق،\n${safeTenant}`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            .info-box { background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 16px; border-radius: 6px; margin: 16px 0; color: #1e40af; font-size: 15px; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>موعد بدء الاختبار</h1>
            <p>مرحباً ${name}،</p>
            <p>أصبح اختبار <strong>${safeQuiz}</strong>${courseTextAr} متاحاً الآن لأدائه.</p>
            ${durationAr ? `<div class="info-box">${durationAr}</div>` : ""}
            ${examBtnAr}
            <div class="footer">
              <p>منصة إتقان - ${safeTenant}</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: `Exam Now Open: ${safeQuiz} - ${safeTenant}`,
    text: `Hello ${name},\n\nThe exam "${safeQuiz}"${courseTextEn} is now open.\n${durationEn ? `${durationEn}\n` : ""}${params.examUrl ? `You can take the exam by visiting:\n${params.examUrl}\n` : ""}\nBest regards,\n${safeTenant}`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
          h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
          p { font-size: 15px; line-height: 1.6; color: #374151; }
          .info-box { background-color: #eff6ff; border: 1px solid #bfdbfe; padding: 16px; border-radius: 6px; margin: 16px 0; color: #1e40af; font-size: 15px; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
          .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          .raw-link { word-break: break-all; color: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Exam Now Open</h1>
          <p>Hello ${name},</p>
          <p>The exam <strong>${safeQuiz}</strong>${courseTextEn} is now open and available to take.</p>
          ${durationEn ? `<div class="info-box">${durationEn}</div>` : ""}
          ${examBtnEn}
          <div class="footer">
            <p>Itqan Platform - ${safeTenant}</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

export interface CourseAccessEmailParams {
  studentName?: string;
  courseTitle: string;
  courseUrl?: string;
  tenantName: string;
  locale?: EmailLocale;
}

export function getCourseAccessEmail(params: CourseAccessEmailParams) {
  const isArabic = params.locale !== "en";
  const name = params.studentName ? escapeHtml(params.studentName) : isArabic ? "عزيزي الطالب" : "Dear Student";
  const safeCourse = escapeHtml(params.courseTitle);
  const safeTenant = escapeHtml(params.tenantName);

  const courseBtnAr = params.courseUrl
    ? `<p><a href="${params.courseUrl}" class="btn">الانتقال إلى الدورة</a></p><p class="raw-link">${params.courseUrl}</p>`
    : "";
  const courseBtnEn = params.courseUrl
    ? `<p><a href="${params.courseUrl}" class="btn">Go to Course</a></p><p class="raw-link">${params.courseUrl}</p>`
    : "";

  if (isArabic) {
    return {
      subject: `تم تفعيل اشتراكك في دورة ${safeCourse} - ${safeTenant}`,
      text: `مرحباً ${name}،\n\nيسعدنا إعلامك بأنه تم تفعيل وصولك إلى دورة "${safeCourse}" في ${safeTenant}.\n${params.courseUrl ? `يمكنك بدء متابعة الدروس عبر الرابط التالي:\n${params.courseUrl}\n` : ""}\nنتمنى لك دراسة ممتعة ومفيدة،\n${safeTenant}`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>تم تفعيل اشتراك الدورة</h1>
            <p>مرحباً ${name}،</p>
            <p>تم تفعيل صلاحية وصولك بنجاح إلى دورة <strong>${safeCourse}</strong> لدى ${safeTenant}.</p>
            ${courseBtnAr}
            <div class="footer">
              <p>منصة إتقان - ${safeTenant}</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: `Course Access Granted: ${safeCourse} - ${safeTenant}`,
    text: `Hello ${name},\n\nYou have been granted access to the course "${safeCourse}" on ${safeTenant}.\n${params.courseUrl ? `You can start learning by visiting:\n${params.courseUrl}\n` : ""}\nBest regards,\n${safeTenant}`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
          h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
          p { font-size: 15px; line-height: 1.6; color: #374151; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
          .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          .raw-link { word-break: break-all; color: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Course Access Granted</h1>
          <p>Hello ${name},</p>
          <p>You have been enrolled in <strong>${safeCourse}</strong> on ${safeTenant}.</p>
          ${courseBtnEn}
          <div class="footer">
            <p>Itqan Platform - ${safeTenant}</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

export interface GuardianConsentEmailParams {
  studentName: string;
  tenantName: string;
  url: string;
  locale?: EmailLocale;
}

/** 10R.7 (FR-A06, ADR-014): asks the guardian to confirm consent for a student under 18. */
export function getGuardianConsentEmail(params: GuardianConsentEmailParams) {
  const isArabic = params.locale !== "en";
  const student = escapeHtml(params.studentName);
  const tenant = escapeHtml(params.tenantName);
  const style = `body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }`;

  if (isArabic) {
    return {
      subject: `موافقة ولي الأمر على حساب ${params.studentName} - منصة إتقان`,
      text: `مرحباً،\n\nسجّل ${params.studentName} حساباً لدى ${params.tenantName} على منصة إتقان، وذكر أنك ولي أمره. لا يمكنه فتح محتوى الدورات قبل موافقتك.\n\nلقراءة الشروط وتأكيد الموافقة افتح الرابط التالي:\n${params.url}\n\nالرابط صالح لمدة 7 أيام. إذا لم تكن ولي أمر هذا الطالب، فتجاهل هذه الرسالة.`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head><meta charset="utf-8"><style>${style}</style></head>
        <body>
          <div class="container">
            <h1>طلب موافقة ولي الأمر</h1>
            <p>سجّل <strong>${student}</strong> حساباً لدى <strong>${tenant}</strong> على منصة إتقان، وذكر أنك ولي أمره. لا يمكنه فتح محتوى الدورات قبل موافقتك.</p>
            <p><a href="${params.url}" class="btn">قراءة الشروط والموافقة</a></p>
            <p class="raw-link">${params.url}</p>
            <div class="footer">
              <p>الرابط صالح لمدة 7 أيام. إذا لم تكن ولي أمر هذا الطالب، فتجاهل هذه الرسالة.</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: `Guardian consent for ${params.studentName} - Itqan`,
    text: `Hello,\n\n${params.studentName} has an account with ${params.tenantName} on Itqan and named you as their guardian. They cannot open course content until you consent.\n\nRead the terms and confirm here:\n${params.url}\n\nThe link is valid for 7 days. If you are not this student's guardian, ignore this email.`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head><meta charset="utf-8"><style>${style}</style></head>
      <body>
        <div class="container">
          <h1>Guardian consent request</h1>
          <p><strong>${student}</strong> has an account with <strong>${tenant}</strong> on Itqan and named you as their guardian. They cannot open course content until you consent.</p>
          <p><a href="${params.url}" class="btn">Read the terms and consent</a></p>
          <p class="raw-link">${params.url}</p>
          <div class="footer">
            <p>The link is valid for 7 days. If you are not this student's guardian, ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

export interface DeviceRequestDecidedEmailParams {
  studentName?: string;
  status: "approved" | "rejected";
  requestType: "device_change" | "sign_out_other";
  tenantName: string;
  loginUrl?: string;
  locale?: EmailLocale;
}

export function getDeviceRequestDecidedEmail(params: DeviceRequestDecidedEmailParams) {
  const isArabic = params.locale !== "en";
  const name = params.studentName ? escapeHtml(params.studentName) : isArabic ? "عزيزي الطالب" : "Dear Student";
  const safeTenant = escapeHtml(params.tenantName);
  const isApproved = params.status === "approved";

  const reqNameAr = params.requestType === "device_change" ? "تغيير الجهاز" : "تسجيل الخروج من الأجهزة الأخرى";
  const reqNameEn = params.requestType === "device_change" ? "device change" : "sign out other devices";

  const loginBtnAr = params.loginUrl && isApproved
    ? `<p><a href="${params.loginUrl}" class="btn">تسجيل الدخول الآن</a></p><p class="raw-link">${params.loginUrl}</p>`
    : "";
  const loginBtnEn = params.loginUrl && isApproved
    ? `<p><a href="${params.loginUrl}" class="btn">Sign In Now</a></p><p class="raw-link">${params.loginUrl}</p>`
    : "";

  if (isArabic) {
    const subject = isApproved
      ? `تمت الموافقة على طلب ${reqNameAr} - ${safeTenant}`
      : `تم رفض طلب ${reqNameAr} - ${safeTenant}`;

    const bodyText = isApproved
      ? `يسرنا إبلاغك بأنه تمت الموافقة على طلب (${reqNameAr}) بنجاح. يمكنك الآن تسجيل الدخول والمتابعة.`
      : `نود إعلامك بأنه تعذر قبول طلب (${reqNameAr}). إذا كان لديك أي استفسار، يرجى التواصل مع الدعم الفني أو معلمك.`;

    return {
      subject,
      text: `مرحباً ${name}،\n\n${bodyText}\n${params.loginUrl && isApproved ? `رابط تسجيل الدخول:\n${params.loginUrl}\n` : ""}\nمع تحيات،\n${safeTenant}`,
      html: `
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
            .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
            h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
            p { font-size: 15px; line-height: 1.6; color: #374151; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
            .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
            .raw-link { word-break: break-all; color: #2563eb; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>${isApproved ? "تمت الموافقة على الطلب" : "قرار بشأن الطلب"}</h1>
            <p>مرحباً ${name}،</p>
            <p>${bodyText}</p>
            ${loginBtnAr}
            <div class="footer">
              <p>منصة إتقان - ${safeTenant}</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  const subject = isApproved
    ? `Device Request Approved: ${reqNameEn} - ${safeTenant}`
    : `Device Request Rejected: ${reqNameEn} - ${safeTenant}`;

  const bodyText = isApproved
    ? `We are pleased to inform you that your request for ${reqNameEn} has been approved. You may now sign in and continue.`
    : `We regret to inform you that your request for ${reqNameEn} could not be approved. Please contact support or your instructor for details.`;

  return {
    subject,
    text: `Hello ${name},\n\n${bodyText}\n${params.loginUrl && isApproved ? `Sign in URL:\n${params.loginUrl}\n` : ""}\nBest regards,\n${safeTenant}`,
    html: `
      <!DOCTYPE html>
      <html dir="ltr" lang="en">
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f9fafb; margin: 0; padding: 20px; color: #111827; }
          .container { max-width: 560px; margin: 0 auto; background: #ffffff; padding: 32px; border-radius: 8px; border: 1px solid #e5e7eb; }
          h1 { font-size: 20px; font-weight: 600; margin-top: 0; color: #111827; }
          p { font-size: 15px; line-height: 1.6; color: #374151; }
          .btn { display: inline-block; padding: 12px 24px; background-color: #111827; color: #ffffff !important; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; margin: 16px 0; }
          .footer { font-size: 13px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          .raw-link { word-break: break-all; color: #2563eb; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${isApproved ? "Request Approved" : "Request Decision"}</h1>
          <p>Hello ${name},</p>
          <p>${bodyText}</p>
          ${loginBtnEn}
          <div class="footer">
            <p>Itqan Platform - ${safeTenant}</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}

