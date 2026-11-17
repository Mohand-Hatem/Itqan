# LMS backend audit (November 2026)

Status: **superseded** (2026-11-17). Historical audit notes only. The approved design is in [ADR-012](../../adr/012-no-two-factor.md), [ADR-013](../../adr/013-account-provisioning.md), [ADR-014](../../adr/014-guardian-consent.md), the SRS and Phase 10R of [tasks/todo.md](../../../tasks/todo.md); where this file disagrees with them, they win.

This folder holds the review the owner asked for on 2026-11-17. The approved parts move into the source-of-truth docs (`02-srs.md`, `05-auth-devices.md`, `07-api.md`, `09-security.md`, a new ADR) when they are built; until then these files are proposals and the existing docs still win.

| File | What it covers |
|---|---|
| [lms-backend-audit.md](lms-backend-audit.md) | How the backend works today and what is wrong with it (this file) |
| [authorization-matrix.md](authorization-matrix.md) | Who can do what today, and the proposed changes |
| [tenant-membership-design.md](tenant-membership-design.md) | Several teachers and assistants per tenant |
| [authentication-simplification.md](authentication-simplification.md) | Better Auth inventory, 2FA options, routes to switch off |
| [swagger-redesign-plan.md](swagger-redesign-plan.md) | New Swagger groups, documentation standard, testability |
| [implementation-plan.md](implementation-plan.md) | Ordered steps, tests, rollback, acceptance criteria |

## 1. Architecture today

```text
Browser ──► Nginx (:8080)
              ├─ /api/auth/*  ──► apps/web (Next.js)  ── Better Auth handler (app/api/auth/[...all]/route.ts)
              ├─ /api/*       ──► apps/api (NestJS)   ── all LMS routes, SSE
              └─ /*           ──► apps/web pages (none built yet, Track A)
```

- **Better Auth runs inside the Next.js app**, not inside NestJS. `http://demo.localhost:4000/api/auth/sign-up/email` returns 404 from Nest; through Nginx on :8080 the same route answers. Both apps share one `auth` object from `packages/auth`.
- **NestJS** has 99 route operations (including 3 alias pairs) in 35 controllers. Better Auth adds 42 more.
- **Packages:** `packages/auth` (Better Auth config plus three plugins: `twoFactor`, our `staffMfaPlugin`, our `studentSignInPlugin`), `packages/database` (Prisma, the tenant-scoping extension), `packages/shared` (Zod schemas used by both the API and the OpenAPI document).

### Request pipeline in NestJS

1. `TenantMiddleware` (`tenancy/tenant.middleware.ts`) reads the Host header. `admin.<root>` gives the admin context, `<slug>.<root>` gives a tenant context, anything else returns 404 `TENANT_NOT_FOUND`. Only `/health` skips this.
2. `SessionGuard` loads the Better Auth session from the cookie.
3. `AccessGuard` (`auth/access.guard.ts`):
   - a suspended user gets 403 `USER_SUSPENDED` everywhere;
   - `@SuperAdminOnly()` routes, and every route on the admin host, need `users.is_super_admin`;
   - on a tenant host it loads the caller's membership for that tenant, checks paused roles, then checks `@Roles(...)`. A super admin passes every `@Roles` check, even with no membership in that tenant;
   - staff and super admins without TOTP get 403 `MFA_ENROLMENT_REQUIRED`, except on routes marked `@AllowWithoutMfa()` (only `GET /me`).
4. `DeviceGuard` checks the student device cookie against the session's device.
5. Services read and write through the tenant-scoped Prisma client, which adds `tenant_id` to every query in a tenant context. Code that uses `systemPrisma` (unscoped) filters `tenant_id` by hand. I read the unscoped queries in enrollments, students and code redemption, and each one filters by tenant.

## 2. People, tenants and roles

| Table | Scope | Key facts |
|---|---|---|
| `users` | Global | One row per email. `is_super_admin`, `max_devices`, `status`, `two_factor_enabled` live here, so they apply on every tenant. |
| `memberships` | Per tenant | `(tenant_id, user_id)` is unique; `role` is `teacher`, `assistant` or `student`; `status` is `active` or `suspended`. |
| `sessions` | Global, tagged | Student sessions carry `tenant_id` and `device_id` (set only by our student sign-in). Staff sessions carry neither and work on every tenant where the user is staff. |
| `devices` | Global | One set per user, shared by all tenants (ADR-004, ADR-007). |
| `two_factor` | Global | Better Auth's TOTP secret and backup codes. |

Answers to the owner's questions:

| Question | Answer from the code |
|---|---|
| Is a teacher tied to one tenant? | No. A teacher is a user with a `teacher` membership. One user can hold memberships in many tenants. |
| One-to-one Teacher and Tenant? | No such table or constraint exists. Only the super admin tenant API assumes one teacher (section 5, F5). |
| Several memberships per user? | Yes, one per tenant (ADR-007, FR-A04). |
| Are roles global? | No. Roles are per membership. Only `is_super_admin` is global. |
| How is the active tenant chosen? | From the Host header only, on every request. Never from the body, query or session. |
| Is the tenant in the session? | Only for student sessions (`sessions.tenant_id`). Staff sessions have none; the guard looks up the membership for the current host on each request. |
| How is cross-tenant access blocked? | Host-based tenant context, the membership lookup in `AccessGuard`, the tenant-scoped Prisma extension, hand filters on `systemPrisma`, and the isolation tests (`isolation.int.spec.ts` plus the fixture sweep). |

## 3. Routes and what they do

The full role-by-route table is in [authorization-matrix.md](authorization-matrix.md). By area:

| Area | Routes | Used by |
|---|---|---|
| Sign-in and session | Better Auth `/api/auth/*`, our `/sign-in/student`, `/mfa/status`, `GET /me`, `GET /me/devices` | Everyone |
| Joining a tenant | `POST /register` (invitation), `POST /register-with-code`, `GET /invitations/check`, `POST /invitations/accept`, `POST /codes/redeem` | New and existing students |
| Inviting and codes | `/invitations` (create, list, resend, revoke), `/code-batches` (create, list, codes, revoke) | Staff |
| Students | `GET /students`, `GET /students/{id}`, `PATCH /students/{id}`, `POST /students/{id}/force-signout`, `POST /devices/{id}/revoke` | Staff |
| Enrollments | `POST /students/{id}/enrollments`, `DELETE /enrollments/{id}`, `GET /courses/{id}/access` | Staff; the last one is the student's own check |
| Device and support requests | `POST /device-requests`, `POST /signout-requests` (both public, password re-checked), `/support-requests` (create, list, approve, reject, close) | Blocked students; staff decide |
| Courses and content | `/courses`, `/content-items`, `GET /courses/{id}/tree`, `/uploads` | Staff; students read the tree and content links |
| Learning | `PUT /progress/{itemId}`, `GET /courses/{id}/progress`, `/content-items/{id}/comments`, `/comments/{id}` | Students; staff moderate comments |
| Exams | `/question-banks`, `/questions`, `/quizzes` (incl. publish, release grades), `/attempts` (start, answer, submit, review, extend, move device) | Staff author; students take |
| Messages | `/notifications`, `/sse` (alias `/notifications/stream`), `/announcements` | Everyone |
| Academy admin | `/settings`, `GET /public/settings`, `/assistants`, `/analytics/overview`, `/audit-logs` | Teacher (analytics: assistants too) |
| Platform admin | `/admin/tenants`, `PATCH /admin/users/{id}` | Super admin |
| System | `GET /health` | Monitoring |

## 4. Authentication today

- **Students** sign in at `POST /api/auth/sign-in/student`. One transaction checks the password, the tenant membership, the device limit and the one-session rule, then binds the device cookie (`__Secure-lms_device`). A database hook stops any other route from creating a session for a student-only user (`guardStudentSession`).
- **Staff and super admins** sign in at `POST /api/auth/sign-in/email`, then pass TOTP (`/two-factor/verify-totp`). Until they enrol, every API call except `GET /me` returns 403 `MFA_ENROLMENT_REQUIRED`.
- **Email verification** is required before the first sign-in. **Password reset** goes by email and ends all sessions.
- **Rate limits:** 5 per minute on both sign-ins and on `/two-factor/*`, 3 per 15 minutes on reset and verification emails.

Details and the full route list are in [authentication-simplification.md](authentication-simplification.md).

## 5. Findings

Severity is my estimate for this product (minors' data, access codes that are sold for money).

| # | Severity | Finding | Evidence |
|---|---|---|---|
| F1 | Medium | **Public sign-up is open**, against FR-A05 ("Public self-registration is disabled"). Anyone can create a user through Better Auth's stock route. The account has no membership, so it opens no course by itself, but see F2. | `POST http://demo.localhost:8080/api/auth/sign-up/email` with an empty body returns 400 (validation), not 404. Nothing in `auth.ts` turns it off. |
| F2 | Medium | **Code redemption creates a student membership without guardian consent.** `POST /codes/redeem` makes a new `student` membership for any signed-in user who has none in that tenant, with no `isMinor`/`guardianConsent` fields and no `guardian_consent_at`. With F1, a person can join any tenant as a student without the consent step FR-A06 requires. `/register`, `/register-with-code` and `/invitations/accept` all enforce consent. | `code-redemption.service.ts:359` (membership create), `CodeRedeemSchema` has only `code` |
| F3 | High for usability | **Swagger cannot be used to test the API.** 0 of 99 operations have a summary, a description, query parameters or a response schema. Tags are the 35 controller class names plus one for Better Auth. The only server is `demo.localhost:8080`, a different origin from the docs page, and the API has no CORS, so "Try it out" fails. The auth routes do not exist on :4000. The local database has no users, and no API can create the first super admin. | `GET /api/docs-json`; `openapi/document.ts`; `seed.ts` creates only the tenant; local DB has 0 users |
| F4 | Decision | **The docs disagree with each other about assistants.** The SRS role table (§2) gives assistants "Students, enrollments, invitations, codes". FR-E02 says the teacher generates codes and FR-E05 says the teacher or super admin ends enrollments. The code follows FR-E02 and FR-E05: assistants cannot create or revoke code batches or end enrollments. | `docs/02-srs.md:42-46` vs `:95-97`; `code-batches.controller.ts:28,72`; `enrollments.controller.ts:49` |
| F5 | Medium for Change 2 | **The super admin tenant API assumes one teacher.** Create takes one `teacherEmail`; list, get and update return only the first teacher (`take: 1`). There is no route to add a second teacher, remove a teacher or list a tenant's staff. | `admin-tenants.service.ts` (create, list, getById, update) |
| F6 | Low | A teacher can link any existing user as an assistant by email, without that person agreeing. The linked person gains access to the tenant's student data at their next request. | `assistants.service.ts:49-64` |
| F7 | Low | Three error shapes: Nest `{statusCode, reason, message}`, the tenant middleware's `{error: {code, message}}`, and Better Auth's `{code, message}`. Swagger should document all three; merging them is optional. | `tenant.middleware.ts`, Better Auth |
| F8 | Low | Three alias pairs show up as separate operations: `/sse` and `/notifications/stream`, `/attempts/{id}/extend` and `/extend-time`, `/move-device` and `/transfer-device`. `docs/07-api.md` names only `/sse`, `/extend` and `/move-device`. | `sse.controller.ts`, `attempts.controller.ts` |
| F9 | Gap, not requested | Staff have no route to see one student's progress. `GET /courses/{id}/progress` is student-only; analytics returns totals only. | `progress.controller.ts:35` |

Already tracked in [../../../tasks/security-backlog.md](../../../tasks/security-backlog.md), not repeated here: global `max_devices` and devices (a teacher of tenant A changes them for tenant B too), `@Public` redeem and accept routes skipping `DeviceGuard`, the unaudited Better Auth account and two-factor routes, and pre-auth email cost.

## 6. Change 1 (assistants enroll students) is already done

- Route: `POST /api/students/{membershipId}/enrollments`, `enrollments.controller.ts:23-24`, `@Roles("teacher", "assistant")`.
- The service (`enrollments.service.ts`, `grant`) has no role check of its own. It checks the tenant, that the target membership is a student (`INVALID_TARGET_ROLE`), that the course exists in the tenant, and that no active enrollment exists (`ALREADY_ENROLLED`), then writes in one transaction. The database also has `@@unique([membershipId, courseId])`.
- Test: `enrollments.int.spec.ts:110` "allows assistant to manually grant course enrollment to a student".
- Students get 403 `ROLE_FORBIDDEN` from `AccessGuard`.

If an assistant got a 403 while trying this in Swagger, the likely cause is `MFA_ENROLMENT_REQUIRED`: assistants must set up TOTP before any staff route works. The 403 body's `reason` field tells the two apart.

No code change is needed. The restrictions the owner asked to keep are in place: ending enrollments (`DELETE /enrollments/{id}`, teacher only), changing `max_devices` (teacher only, `students-access.service.ts:110`), creating and revoking code batches (teacher only), managing assistants (teacher only), tenant settings (teacher only).

## 7. Swagger problems today

1. No summaries, descriptions, query parameters, response schemas or examples on any of our 99 operations.
2. 36 tags, 35 of them named after controller classes (`StudentsAccess`, `StudentEnrollments`, `CourseTree`), with no descriptions or order.
3. All 42 Better Auth routes appear, including social login, account linking, email OTP and account deletion, which this app never uses.
4. "Try it out" cannot work: wrong origin, no CORS, auth served by another app.
5. Only the session cookie is declared; the student device cookie is not.
6. No test users exist locally, and staff need TOTP before any staff route works.
7. Roles, tenant rules and business rules appear nowhere.
