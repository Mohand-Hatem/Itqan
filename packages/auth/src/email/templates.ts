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
            <h1>مرحباً ${name}،</h1>
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
          <h1>Hello ${name},</h1>
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
            <h1>مرحباً ${name}،</h1>
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
          <h1>Hello ${name},</h1>
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
  courseTitles?: string[];
  locale?: EmailLocale;
}

export function getInvitationEmail(params: InvitationEmailParams) {
  const isArabic = params.locale !== "en";
  const coursesTextAr =
    params.courseTitles && params.courseTitles.length > 0
      ? `للدورات التالية:\n- ${params.courseTitles.join("\n- ")}\n\n`
      : "";
  const coursesHtmlAr =
    params.courseTitles && params.courseTitles.length > 0
      ? `<p>للدورات التدريبية التالية:</p><ul>${params.courseTitles.map((t) => `<li><strong>${t}</strong></li>`).join("")}</ul>`
      : "";

  const coursesTextEn =
    params.courseTitles && params.courseTitles.length > 0
      ? `for the following courses:\n- ${params.courseTitles.join("\n- ")}\n\n`
      : "";
  const coursesHtmlEn =
    params.courseTitles && params.courseTitles.length > 0
      ? `<p>for the following courses:</p><ul>${params.courseTitles.map((t) => `<li><strong>${t}</strong></li>`).join("")}</ul>`
      : "";

  if (isArabic) {
    return {
      subject: `دعوة للانضمام إلى ${params.tenantName} - منصة إتقان`,
      text: `مرحباً،\n\nلقد تمت دعوتك للانضمام إلى أكاديمية ${params.tenantName} على منصة إتقان ${coursesTextAr}يرجى استخدام الرابط التالي لإتمام انضمامك:\n${params.url}\n\nهذا الرابط صالح للاستخدام مرة واحدة ولمدة 72 ساعة.\nإذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.`,
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
            <h1>دعوة للانضمام إلى ${params.tenantName}</h1>
            <p>تمت دعوتك للانضمام كطالب إلى <strong>${params.tenantName}</strong> على منصة إتقان.</p>
            ${coursesHtmlAr}
            <p><a href="${params.url}" class="btn">قبول الدعوة والتسجيل</a></p>
            <p>أو يمكنك نسخ الرابط التالي ولصقه في متصفحك مباشرة:</p>
            <p class="raw-link">${params.url}</p>
            <div class="footer">
              <p>هذا الرابط صالح للاستخدام مرة واحدة ولمدة 72 ساعة. إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهلها بأمان.</p>
            </div>
          </div>
        </body>
        </html>
      `.trim(),
    };
  }

  return {
    subject: `Invitation to join ${params.tenantName} - Itqan Platform`,
    text: `Hello,\n\nYou have been invited to join ${params.tenantName} on Itqan Platform ${coursesTextEn}Please use the following link to complete your registration:\n${params.url}\n\nThis single-use link expires in 72 hours.\nIf you did not expect this invitation, you can safely ignore this email.`,
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
          <h1>Invitation to join ${params.tenantName}</h1>
          <p>You have been invited to join <strong>${params.tenantName}</strong> on the Itqan Platform.</p>
          ${coursesHtmlEn}
          <p><a href="${params.url}" class="btn">Accept Invitation & Register</a></p>
          <p>Or copy and paste this URL into your browser:</p>
          <p class="raw-link">${params.url}</p>
          <div class="footer">
            <p>This single-use link expires in 72 hours. If you did not expect this invitation, you can safely ignore this email.</p>
          </div>
        </div>
      </body>
      </html>
    `.trim(),
  };
}
