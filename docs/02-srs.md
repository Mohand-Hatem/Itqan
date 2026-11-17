# SRS: Itqan

IDs are stable; reference them in tasks and tests.

Requirements changed on 2026-11-17 by [ADR-012](adr/012-no-two-factor.md), [ADR-013](adr/013-account-provisioning.md) and [ADR-014](adr/014-guardian-consent.md) are built in Phase 10R of [../tasks/todo.md](../tasks/todo.md). Until a step there is ticked, the code may still follow the old rule.

## 1. Functional requirements

### Tenancy and super admin
| ID | Requirement |
|---|---|
| FR-T01 | The tenant is resolved from the request hostname (`<slug>.<root-domain>`). Unknown hosts return 404. |
| FR-T02 | The super admin creates tenants with a slug, a name and a first teacher, and manages each tenant's teachers and assistants. A tenant can have several teachers and assistants and always keeps at least one active teacher. |
| FR-T03 | The super admin can pause any combination of roles in a tenant (teacher, assistants, students) and suspend individual users, except a tenant's last active teacher. |
| FR-T04 | The super admin can soft-delete a tenant. Data and files are purged after 30 days. |
| FR-T05 | The super admin sees per-tenant usage: student count, course count, storage bytes. |
| FR-T06 | The teacher edits branding and public settings: name, logo, favicon, colors, hero, about, how-it-works, contact info, social links, default language, timezone, device limit default. |

### Accounts and auth
| ID | Requirement |
|---|---|
| FR-A01 | Users sign in with email and password. Accounts created by access-code registration must verify their email before first sign-in. Accepting an invitation verifies the email. Accounts created directly by staff are active without verification. |
| FR-A02 | Password reset by email link, sent only to verified email addresses. A user whose address is not verified gets a new password from the super admin (FR-A07). |
| FR-A03 | There is no two-factor authentication. Staff accounts are protected by the password rules (FR-A09), rate limits, the sign-in audit (FR-L01) and session revocation ([ADR-012](adr/012-no-two-factor.md)). |
| FR-A04 | One user (email) can hold memberships in several tenants, with a different role in each. Data stays per tenant. |
| FR-A05 | Public self-registration is disabled. Accounts are created only by invitation, by access-code registration, directly by authorized staff (FR-E08), or by the super admin bootstrap (FR-A10). |
| FR-A06 | A student under 18 needs guardian consent, recorded once per person and reused in every academy. The guardian gives it through an emailed confirmation link, or academy staff record it from a signed offline form, by document reference. A student's own checkbox is not consent. Until consent is recorded, a minor can sign in but cannot open course content, save progress, post questions, or start or continue assessments. Withdrawing consent closes the same access. Code redemption never asks for consent ([ADR-014](adr/014-guardian-consent.md)). |
| FR-A07 | Only the super admin can set another user's password, never another super admin's. It ends all of that user's sessions, is audited, and the user must choose a new password at the next sign-in. Teachers and assistants cannot reset passwords. |
| FR-A08 | Staff accounts created directly must change their password at first sign-in. For students created directly this is a choice, on by default. Until the change, the API answers only the current-user route. |
| FR-A09 | Teacher, assistant and super admin passwords have at least 12 characters; student passwords at least 8. An account that receives its first staff role must choose a new password before acting as staff. |
| FR-A10 | The first super admin is created by a server-side bootstrap command, which also recovers a super admin's password. No API route creates or promotes a super admin. |

### Devices and sessions
| ID | Requirement |
|---|---|
| FR-D01 | The first student login binds the browser as the user's device. |
| FR-D02 | `max_devices` per user, default 1, changeable by teacher or super admin. |
| FR-D03 | Login from an unregistered browser when the limit is reached is blocked, with a "Request device change" action. |
| FR-D04 | Only one device may hold an active session. A login is blocked while an unexpired session exists on another device. |
| FR-D05 | The blocked screen offers "Request sign-out of other device". |
| FR-D06 | Teacher, assistants and super admin can approve requests, revoke devices and force sign-out. |
| FR-D07 | Sessions expire after 30 days of inactivity (sliding). Sign-out frees the slot at once. |
| FR-D08 | Staff and super admin accounts are exempt from device binding. |

### Access and enrollment
| ID | Requirement |
|---|---|
| FR-E01 | Email invitations: the super admin invites any role into any tenant, the teacher invites assistants and students, the assistant invites students. Student invitations can grant one or more courses. Links expire after 72 hours, are single-use, can be resent or revoked, and accepting one verifies the email. |
| FR-E02 | The teacher generates access codes in batches per course and exports them as CSV. Codes are single-use and revocable. Codes are never sent by email. |
| FR-E03 | A new student registers with an invitation or a code, or staff create the account (FR-E08). An existing student redeems a code from their account, with no consent step. |
| FR-E04 | Enrollment is lifetime until terminated. |
| FR-E05 | The teacher or super admin can terminate an enrollment. History and grades stay. |
| FR-E06 | The teacher records offline payments: student, course (optional), amount, date, method, note. |
| FR-E07 | Teachers and assistants enroll existing students in a course by hand. Ending an enrollment stays with the teacher and super admin (FR-E05). |
| FR-E08 | Accounts are created directly or by invitation (FR-E01). Direct: the creator sets the password, the account is active at once, no email is sent and the address stays unverified. The super admin creates any role in any tenant, the teacher assistants and students in their tenant, the assistant students in their tenant. Teachers and assistants cannot directly create an account for an email that already has one; they send an invitation. The super admin can link an existing account to a tenant directly, without changing its password, profile or other memberships ([ADR-013](adr/013-account-provisioning.md)). |

### Content
| ID | Requirement |
|---|---|
| FR-C01 | Courses contain a tree of folders, chapters and lectures, up to 5 levels deep. |
| FR-C02 | Items can be created, renamed, moved, reordered, published, unpublished, soft-deleted and restored. |
| FR-C03 | Uploads go directly from the browser to R2 with presigned URLs. Allowed: PDF, DOCX, PPTX, images, MP4. Size limits per type. |
| FR-C04 | PDFs are viewable in-browser; each file is view-only or downloadable. DOCX/PPTX are download-only. |
| FR-C05 | Videos play from short-lived signed URLs with a moving watermark of the student's name and email. |
| FR-C06 | Students see only published items of courses with an active enrollment. |
| FR-C07 | Student progress: completed items and last video position. |
| FR-C08 | Lesson Q&A: students post, staff reply, staff can hide or delete posts. |

### Exams
| ID | Requirement |
|---|---|
| FR-X01 | Question banks: global (tenant-wide) and per course. Types: single MCQ, multiple MCQ, true/false. Fields: text, options, correct answers, marks, difficulty, explanation, tags, optional image. |
| FR-X02 | A quiz targets a course, chapters or lectures, and uses manual or random question selection. |
| FR-X03 | Quiz settings: open and close time, duration, max attempts, pass mark, shuffle questions and options, navigation mode, grace period. |
| FR-X04 | The server clock is the authority. Answers autosave. Attempts auto-submit at the deadline plus grace. |
| FR-X05 | An attempt freezes a snapshot of its questions. Editing the bank later does not change past results. |
| FR-X06 | Grading is server-side. |
| FR-X07 | Grade release: after submit, after all eligible submit (falls back to close time), after close time, or manual. |
| FR-X08 | Review release: grade only, grade with correct answers, or full review with explanations, each with its own release time. |
| FR-X09 | Staff can extend one student's attempt time. |
| FR-X10 | An attempt is tied to the device that started it. |

### Notifications and support
| ID | Requirement |
|---|---|
| FR-N01 | Notifications are stored and shown in a bell with an unread count. |
| FR-N02 | Online users get them instantly over SSE. |
| FR-N03 | Important types also go by push (FCM) and email (Resend): invitation, password reset, guardian consent request, grade released, exam opening, new course access, device request decided. Emails go only to verified addresses, except the invitation and the guardian consent request, which go to the address being invited or asked. |
| FR-N04 | Staff publish announcements to the whole tenant or one course. |
| FR-N05 | Support requests have types: device change, sign-out other device, general. |

### Audit and analytics
| ID | Requirement |
|---|---|
| FR-L01 | Every staff and super admin write action creates an audit entry. Blocked logins are logged too, and so is every staff and super admin sign-in attempt, successful or failed, with a failure category but never a password, token or the email of an unknown account. |
| FR-L02 | Dashboard numbers: students, active students (7 days), courses, published items, quiz participation, average grades, pending requests. |

## 2. Roles and permissions

| Action | Super admin | Teacher | Assistant | Student |
|---|---|---|---|---|
| Manage tenants, pause roles, suspend users | ✅ | | | |
| Create, invite, re-role and remove teachers | ✅ | | | |
| Link an existing account to a tenant directly | ✅ | | | |
| Set another user's password | ✅ (not super admins) | | | |
| Create or invite assistants, remove assistants | ✅ | ✅ | | |
| Website settings, audit log | ✅ | ✅ | | |
| Payments | ✅ | ✅ | view | |
| Courses, content, exams | ✅ | ✅ | ✅ | |
| Create or invite students, enroll students | ✅ | ✅ | ✅ | |
| End enrollments, change device limits | ✅ | ✅ | | |
| Generate or revoke access-code batches | ✅ | ✅ | view | |
| Devices, sessions, support requests | ✅ | ✅ | ✅ | own |
| Record or withdraw guardian consent | ✅ | ✅ | ✅ | ask a guardian (own) |
| Change a student's minor status after creation | ✅ | | | |
| Delete course | ✅ | ✅ | | |
| Learn, take exams | | | | ✅ |

The super admin has no membership role: it is a platform flag, created only by the bootstrap command (FR-A10). Teacher and assistant rights apply only inside the tenant where the person holds that role.

Shortcut: assistant permissions are fixed. Per-assistant permission toggles come later if teachers ask for them.

## 3. Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-01 | Strict tenant isolation, enforced in the data layer and covered by tests. |
| NFR-02 | Main pages respond in under 500 ms at p95 for 300 concurrent students. |
| NFR-03 | Exam start handles 300 students starting within one minute. |
| NFR-04 | Arabic (RTL) and English throughout, including emails. |
| NFR-05 | Accessible: keyboard navigation, labels, contrast (WCAG 2.1 AA target). |
| NFR-06 | Daily database backups with a tested restore. |
| NFR-07 | Errors reported to Sentry; uptime monitored. |
| NFR-08 | Secrets in environment variables only. |
