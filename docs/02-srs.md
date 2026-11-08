# SRS: Itqan

IDs are stable; reference them in tasks and tests.

## 1. Functional requirements

### Tenancy and super admin
| ID | Requirement |
|---|---|
| FR-T01 | The tenant is resolved from the request hostname (`<slug>.<root-domain>`). Unknown hosts return 404. |
| FR-T02 | The super admin creates tenants with a slug, name and teacher email. |
| FR-T03 | The super admin can pause any combination of roles in a tenant (teacher, assistants, students) and suspend individual users. |
| FR-T04 | The super admin can soft-delete a tenant. Data and files are purged after 30 days. |
| FR-T05 | The super admin sees per-tenant usage: student count, course count, storage bytes. |
| FR-T06 | The teacher edits branding and public settings: name, logo, favicon, colors, hero, about, how-it-works, contact info, social links, default language, timezone, device limit default. |

### Accounts and auth
| ID | Requirement |
|---|---|
| FR-A01 | Users log in with email and password. Email must be verified before first login. |
| FR-A02 | Password reset by email link. |
| FR-A03 | Teacher, assistants and super admin must use TOTP MFA. |
| FR-A04 | One user (email) can hold memberships in several tenants. Data stays per tenant. |
| FR-A05 | Public self-registration is disabled. Students register only with an invitation or an access code. |
| FR-A06 | Registration requires a guardian-consent checkbox for students under 18. |

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
| FR-E01 | The teacher creates email invitations for one or more courses. Links expire after 72 hours, are single-use and can be resent or revoked. |
| FR-E02 | The teacher generates access codes in batches per course and exports them as CSV. Codes are single-use and revocable. |
| FR-E03 | A new student registers with an invitation or a code. An existing student redeems a code from their account. |
| FR-E04 | Enrollment is lifetime until terminated. |
| FR-E05 | The teacher or super admin can terminate an enrollment. History and grades stay. |
| FR-E06 | The teacher records offline payments: student, course (optional), amount, date, method, note. |

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
| FR-N03 | Important types also go by push (FCM) and email (Resend): activation, password reset, grade released, exam opening, new course access, device request decided. |
| FR-N04 | Staff publish announcements to the whole tenant or one course. |
| FR-N05 | Support requests have types: device change, sign-out other device, general. |

### Audit and analytics
| ID | Requirement |
|---|---|
| FR-L01 | Every staff and super admin write action creates an audit entry. Blocked logins are logged too. |
| FR-L02 | Dashboard numbers: students, active students (7 days), courses, published items, quiz participation, average grades, pending requests. |

## 2. Roles and permissions

| Action | Super admin | Teacher | Assistant | Student |
|---|---|---|---|---|
| Manage tenants, pause roles | ✅ | | | |
| Website settings, manage assistants | ✅ | ✅ | | |
| Payments | ✅ | ✅ | view | |
| Courses, content, exams | ✅ | ✅ | ✅ | |
| Students, enrollments, invitations, codes | ✅ | ✅ | ✅ | |
| Devices, sessions, support requests | ✅ | ✅ | ✅ | own |
| Delete course | ✅ | ✅ | | |
| Learn, take exams | | | | ✅ |

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
