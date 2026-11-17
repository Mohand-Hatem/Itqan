# Swagger redesign plan

Status: **superseded** (2026-11-17). Historical audit notes only. The approved design is in [ADR-012](../../adr/012-no-two-factor.md), [ADR-013](../../adr/013-account-provisioning.md), [ADR-014](../../adr/014-guardian-consent.md), the SRS and Phase 10R of [tasks/todo.md](../../../tasks/todo.md); where this file disagrees with them, they win.

Goal: a developer opens `/api/docs`, understands each route without reading the code, signs in, and runs real requests from the page.

## 1. Make "Try it out" work

Without this, better descriptions still leave a page nobody can test from.

| Problem | Fix | Where |
|---|---|---|
| Docs page on `localhost:4000`, server set to `demo.localhost:8080`, no CORS | Use a relative server (`/`) so requests go to the page's own origin. Open the docs at `http://demo.localhost:4000/api/docs` for tenant routes and `http://admin.localhost:4000/api/docs` for super admin routes. | `openapi/document.ts` |
| Better Auth is served by Next.js, so `/api/auth/*` is 404 on :4000 | In development only, mount the same `auth` object on Nest at `/api/auth` with Better Auth's Node handler, in the dev-only `setupApiDocs`. Add `http://*.localhost:4000` to `trustedOrigins` outside production. Production keeps Nginx sending `/api/auth` to Next.js. | `openapi/docs-ui.ts`, `packages/auth/src/auth.ts` |
| No users in the local database, no way to create the first super admin | A dev seed (refused when `NODE_ENV=production`) that creates a super admin, a teacher, an assistant and a student in tenant `demo`, with test passwords read from `.env` (`SEED_*` names added to `.env.example`, rule 3). | `packages/database/src/seed.ts` |
| Staff routes need TOTP first | The "Start here" text walks through enrolment from the page: sign in, `two-factor/enable`, scan the URI, `verify-totp`. With the 2FA recommendation, once per 30 days per browser. | Swagger description |

Risk to check first: Nest's JSON body parser runs before middleware added later, and Better Auth's Node handler reads the raw body. The first task of that step is a spike that signs in through `demo.localhost:4000/api/auth/sign-in/email`. If the parsed body breaks it, the fallback is a dev-only proxy of `/api/auth` to the Next.js dev server on :3000.

## 2. Groups

Fifteen tags, each route in exactly one. Tag order is the order below. Each tag gets a one-paragraph description saying who uses it and how its routes fit together.

The owner suggested audience tags ("Student APIs", "Teacher APIs"). I recommend against them as tags: most routes are shared by teachers and assistants, so audience tags would list the same route two or three times. Each operation instead starts with a "Who" line, and each tag description names its audience.

| # | Tag | Who | Routes |
|---|---|---|---|
| 1 | Start here: Health & System | Anyone | `GET /health`, `GET /auth/ok` |
| 2 | Authentication & My Account | Everyone | Better Auth routes kept (section 6), `POST /auth/sign-in/student`, `GET /me` |
| 3 | Two-Factor (Staff) | Staff, super admin | `/auth/two-factor/*` kept, `GET /auth/mfa/status` (removed or reduced if 2FA changes) |
| 4 | Joining an Academy (Students) | New and existing students | `POST /register`, `POST /register-with-code`, `GET /invitations/check`, `POST /invitations/accept`, `POST /codes/redeem` |
| 5 | Invitations & Access Codes | Teacher, assistant | `/invitations` (create, list, resend, revoke), `/code-batches` (create, list, codes, revoke) |
| 6 | Students | Teacher, assistant | `GET /students`, `GET /students/{id}`, `PATCH /students/{id}`, `POST /students/{id}/force-signout` |
| 7 | Enrollments & Course Access | Teacher, assistant; student for the access check | `POST /students/{id}/enrollments`, `DELETE /enrollments/{id}`, `GET /courses/{id}/access` |
| 8 | Devices & Support Requests | Blocked students; staff decide | `GET /me/devices`, `POST /device-requests`, `POST /signout-requests`, `/support-requests` (5), `POST /devices/{id}/revoke` |
| 9 | Courses & Content | Teacher, assistant; students read | `/courses` (5), `/content-items` (5), `GET /courses/{id}/tree`, `/uploads` (3) |
| 10 | Learning: Progress & Lesson Q&A | Students; staff moderate | `PUT /progress/{itemId}`, `GET /courses/{id}/progress`, comments (4) |
| 11 | Question Banks & Quizzes | Teacher, assistant | `/question-banks` (5), `/questions` (5), `/quizzes` (8) |
| 12 | Quiz Attempts | Students; staff rescue actions | `/attempts` (start, get, answer, answers, submit, review, extend, move device) |
| 13 | Notifications & Announcements | Everyone | `/notifications` (2), `GET /sse`, `/announcements` (2) |
| 14 | Academy Admin (Teacher) | Teacher; public settings for anyone | `/settings` (2), `GET /public/settings`, `/assistants` (3), `GET /analytics/overview`, `GET /audit-logs` |
| 15 | Platform Admin (Super Admin) | Super admin, admin host | `/admin/tenants` (5), `PATCH /admin/users/{id}`, new `/admin/tenants/{id}/staff` (4) |

The alias names (`/notifications/stream`, `/attempts/{id}/extend-time`, `/attempts/{id}/transfer-device`) stay working but appear as `deprecated: true` operations pointing to the names `docs/07-api.md` uses. Removing them is a separate decision.

## 3. The standard for every operation

| Field | Rule | Example |
|---|---|---|
| `summary` | Verb first, says what changes, sentence case, no role in it | "Enroll a student in a course" |
| `operationId` | camelCase verb and noun, unique | `enrollStudentInCourse` |
| `description`, first line | `Who:` roles · `Auth:` cookies needed · `Tenant:` which host | `Who: Teacher, Assistant · Auth: session cookie, TOTP enrolled · Tenant: the current academy host` |
| `description`, body | What it does, why it exists, what happens afterwards (emails, SSE events, sessions ended, audit entry), business rules that the name does not show | see section 5 |
| Path and query parameters | Each one described; query parameters generated from the Zod query schemas (17 exist in `packages/shared`) | `membershipId`: "The student's membership id, from `GET /students`" |
| Request body | From the Zod schema (already done for every write route), plus one realistic example | `{ "courseId": "0193…" }` |
| Responses | Success status and schema (from the Zod response schemas where they exist, about 20 today), plus every error status the route can return, each with its `reason` codes | `409 ALREADY_ENROLLED` |
| Security | `sessionCookie` on every signed-in route; `deviceCookie` also on student routes; none on public routes | |

Shared components:

| Component | Shape | Used for |
|---|---|---|
| `ApiError` | `{ statusCode, reason, message }` | All Nest errors |
| `TenantNotFound` | `{ error: { code: "TENANT_NOT_FOUND", message } }` | Unknown host (middleware) |
| `AuthError` | `{ code, message }` | Better Auth routes |
| `sessionCookie` | cookie `better-auth.session_token` | Signed-in routes |
| `deviceCookie` | cookie `__Secure-lms_device` | Student routes (DeviceGuard) |

The access reason codes every staff or student route can return (`USER_SUSPENDED`, `NO_ACCESS`, `TENANT_PAUSED`, `ROLE_FORBIDDEN`, `MFA_ENROLMENT_REQUIRED`, `DEVICE_NOT_REGISTERED`) are explained once, in the "Start here" text, and each route lists only its own extra reasons.

## 4. Where the documentation lives

One file, `apps/api/src/openapi/operations.ts`: a map from `"METHOD /path"` to `{ tag, summary, operationId, who, description, query?, response?, errors[], deprecated? }`, applied by `buildOpenApiDocument`. It is the same pattern as `openapi/bodies.ts` for request bodies, so there is one way to describe a route.

The alternative is `@ApiOperation`, `@ApiResponse` and similar decorators on each controller method. That keeps docs next to the code but adds 5 to 10 decorator lines per route across 35 controllers. The map keeps the controllers as they are, and a test makes it equally hard to forget a route.

Tests (extending `openapi/openapi.int.spec.ts`):
- every Nest operation has an entry, and the map names no route that does not exist (same check as `bodies.ts`);
- each entry has a tag from the approved list, a summary, an operationId (unique) and a description starting with `Who:`;
- each switched-off Better Auth path is absent from the document;
- `docs/api/openapi.json` is up to date (exists today).

## 5. Three worked examples

These are written from the current code and show the level of detail for every route.

### Enroll a student in a course

`POST /api/students/{membershipId}/enrollments` · tag: Enrollments & Course Access · `enrollStudentInCourse`

> Who: Teacher, Assistant (super admin too) · Auth: session cookie, TOTP enrolled · Tenant: the current academy host
>
> Gives a student lifetime access to one course, by hand: for example after a cash payment. The student sees the course at once, subject to the normal access rules (published items only, membership and course active).
>
> Rules: the membership must belong to a student of this academy; the course must exist here and not be deleted. If the student had an ended enrollment in this course, it is reactivated. Writes an audit entry. Ending an enrollment is a separate route and is teacher-only.

| Part | Content |
|---|---|
| Path | `membershipId` (uuid): the student's membership id from `GET /students` |
| Body | `{ "courseId": "01936d5e-7c1a-7b2c-9d3e-4f5a6b7c8d9e" }` |
| 201 | The enrollment: `id`, `tenantId`, `membershipId`, `courseId`, `status: "active"`, `source: "manual"`, `grantedBy`, `createdAt`, `updatedAt` |
| 400 | `ALREADY_ENROLLED`, `INVALID_TARGET_ROLE` (the membership is staff), validation errors |
| 403 | `ROLE_FORBIDDEN` (student caller), `MFA_ENROLMENT_REQUIRED` |
| 404 | `MEMBERSHIP_NOT_FOUND`, `COURSE_NOT_FOUND` |

### Revoke a student's registered device

`POST /api/devices/{id}/revoke` · tag: Devices & Support Requests · `revokeStudentDevice`

> Who: Teacher, Assistant · Auth: session cookie, TOTP enrolled · Tenant: the current academy host
>
> Frees one of the student's device slots, usually so the student can sign in on a new computer. The device is marked revoked and every session on it ends at once; its open SSE streams get `device_revoked` and close.
>
> Rules: the device must belong to a student of this academy. Devices are shared across academies (ADR-004), so revoking here also signs the student out of that browser on other academies. Writes an audit entry.

| Part | Content |
|---|---|
| Path | `id` (uuid): device id from `GET /students/{id}` |
| 200 | `{ "id": "…", "status": "revoked" }` |
| 403 | `ROLE_FORBIDDEN`, `MFA_ENROLMENT_REQUIRED` |
| 404 | Device not found, or not a device of a student here |

### Register a new student with an access code

`POST /api/register-with-code` · tag: Joining an Academy (Students) · `registerWithAccessCode`

> Who: anyone (public) · Auth: none · Tenant: the academy host the code belongs to
>
> Creates a new student account from a code bought offline, joins this academy and enrolls in the code's course, in one transaction. A verification email follows; the student signs in with `POST /api/auth/sign-in/student` after verifying. People who already have an account use `POST /codes/redeem` instead.
>
> Rules: the code is single use and must not be revoked. Under 18 needs `guardianConsent: true`. Limited to 5 tries per 15 minutes per code.

| Part | Content |
|---|---|
| Body | `code`, `name`, `email`, `password` (8 to 100 characters), `phone` (optional), `isMinor`, `guardianConsent` |
| 201 | `{ "userId", "membershipId", "courseId", "email" }` |
| 400 | `GUARDIAN_CONSENT_REQUIRED`, `INVALID_BODY`, `TENANT_REQUIRED` |
| 404 | `CODE_NOT_FOUND`, `COURSE_NOT_FOUND` |
| 409 | `CODE_NOT_AVAILABLE` (used or revoked), `USER_ALREADY_EXISTS` |
| 429 | Too many tries on this code |

## 6. Better Auth in Swagger

| Kind | Routes | In Swagger |
|---|---|---|
| Our custom auth | `sign-in/student`, `mfa/status` | Tag 2 and tag 3, fully documented by us |
| Better Auth, used | `sign-in/email`, `sign-out`, `get-session`, password reset (3), email verification (2), `change-password`, `update-user`, session management (4) | Tag 2, with our own summary and "when to use" text replacing Better Auth's |
| Better Auth, 2FA | `two-factor/*` kept | Tag 3 |
| Switched off | listed in [authentication-simplification.md](authentication-simplification.md) | Gone (the generator skips `disabledPaths`) |
| Internal | `callback/{id}`, `error` | Hidden by a filter in `document.ts` |

The "Authentication & My Account" tag description is a short guide:

| I want to… | Use |
|---|---|
| Sign in as a student | `POST /api/auth/sign-in/student` (sets the session and device cookies) |
| Sign in as staff or super admin | `POST /api/auth/sign-in/email`, then `POST /api/auth/two-factor/verify-totp` |
| Sign out | `POST /api/auth/sign-out` |
| See who I am and my permissions | `GET /api/me` |
| Reset a forgotten password | `POST /api/auth/request-password-reset`, then `POST /api/auth/reset-password` |
| Resend the verification email | `POST /api/auth/send-verification-email` |
| Change my name or password | `POST /api/auth/update-user`, `POST /api/auth/change-password` |
| See or end my sessions | `GET /api/auth/list-sessions`, `POST /api/auth/revoke-session` |

## 7. Journeys in the top description

The document's main description gets short numbered walkthroughs that link to the operations:

1. **Start here:** run the dev seed, open the docs on the right host, sign in, enrol TOTP for staff.
2. **Student joins with an invitation:** staff `POST /invitations` → student `GET /invitations/check` → `POST /register` (guardian consent if under 18) → verify email → `sign-in/student` → `GET /courses/{id}/tree`.
3. **Student joins with a code:** staff `POST /code-batches` → `GET /code-batches/{id}/codes` → student `POST /register-with-code`, or `POST /codes/redeem` if they have an account.
4. **Manual enrollment:** staff `GET /students` → `POST /students/{id}/enrollments` → student `GET /courses/{id}/access`.
5. **Device limit reached:** student sign-in returns `DEVICE_LIMIT` → `POST /device-requests` → staff `GET /support-requests` → `approve` (the least recently used devices are revoked to make room) or `POST /devices/{id}/revoke`.
6. **Quiz:** staff build a bank and a quiz → `publish` → student `POST /quizzes/{id}/attempts` → answers → `submit` → staff `release-grades` → student `review`.
