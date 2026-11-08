# PRD: teacher-lms

## 1. Problem
Independent teachers sell courses but have no affordable platform that:
- gives them their own branded site,
- stops one paid account being shared among friends,
- handles content, exams and grades in one place.

## 2. Users
| User | Goal |
|---|---|
| Super admin (us) | Onboard teachers, pause or delete them, see usage for billing. |
| Teacher | Sell courses, manage content and exams, control who has access. |
| Assistant | Help the teacher run students, devices, codes and support. |
| Student (any age) | Learn from paid courses on one device. |

## 3. Business model
- **Teachers pay us** by hand (no billing system). Price tiers by student count and storage; usage is computed from the database.
- **Students pay the teacher offline** (cash, transfer). The teacher then grants access by invitation or access code. The teacher records the payment in the dashboard.
- **Online student payments** are a future feature.

## 4. MVP scope
1. **Tenancy:** shared deployment, one subdomain per teacher, per-tenant branding (name, logo, colors, social and contact links, public pages).
2. **Accounts:** email login, email verification, password reset, MFA for teacher, assistants and super admin.
3. **Access:** invitations, access codes, lifetime enrollments, removal from a course by teacher or super admin.
4. **Anti-sharing:** 1 registered device per student (admin can raise it), 1 active session at a time, device change by request and approval.
5. **Content:** course tree (folders, chapters, lectures), PDFs, DOCX/PPTX downloads, MP4 videos with moving watermark.
6. **Exams:** global and course question banks; MCQ single and multiple, true/false; scheduling, attempts, autosave, auto-grading, grade and review release modes.
7. **Engagement:** lesson Q&A with teacher moderation, announcements, notifications (in-app real-time, push, email), support requests.
8. **Admin:** offline payment records, audit log, simple analytics, super admin pause controls.
9. **Languages:** Arabic (default, RTL) and English.

## 5. Out of scope for MVP
- Online payments, subscriptions, invoices.
- Mobile or desktop apps.
- Course expiry, chapter-level selling.
- Short-answer and essay questions, manual grading.
- DOCX/PPTX in-browser preview, Bunny Stream, DRM.
- Teacher self-signup, custom domains, certificates, bulk CSV import.
- Parent accounts.

## 6. Success measures (first teacher)
- No confirmed case of simultaneous use of one account.
- Device-change requests answered within 24 hours.
- Teacher creates a course and an exam without our help.
- Zero cross-tenant data leaks in tests.

## 7. Known limits we accept
- A browser cannot identify a physical device; we bind a browser on a device.
- Screen recording cannot be blocked; the watermark makes leakers traceable.
- One email per student; siblings need separate emails.
