# Task list: Itqan MVP

Each task: acceptance criteria (AC), how to verify, dependencies, size. Requirement IDs refer to [../docs/02-srs.md](../docs/02-srs.md).

## Phase 1: Foundation

- [ ] **Task 1: Monorepo scaffold** · M · deps: none
  - AC: pnpm workspaces with `apps/web`, `apps/api`, `packages/{shared,database,auth}`; `lint`, `typecheck`, `test`, `build` scripts at root; GitHub Actions runs them.
  - Verify: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass locally and in CI.

- [ ] **Task 2: Database base schema** · M · deps: 1
  - AC: Prisma schema for `tenants`, Better Auth tables (+ extra user/session fields), `memberships`, `audit_logs`; first migration on a Neon dev branch; seed creates super admin + one tenant.
  - Verify: `prisma migrate dev` and seed run clean; tables visible in Neon.

- [ ] **Task 3: Tenant resolution and isolation** · M · deps: 2 · FR-T01, NFR-01
  - AC: NestJS middleware resolves the tenant from the host into AsyncLocalStorage; Prisma extension injects `tenant_id` on reads and writes of tenant models; unknown host → 404.
  - Verify: test creates two tenants and proves tenant A cannot read or write B's rows through the extension.

- [ ] **Task 4: Staging deployment** · M · deps: 1
  - AC: Docker Compose (nginx, web, api) on the VPS; wildcard `*.staging.<root>` via Cloudflare; env vars documented in `.env.example`.
  - Verify: `https://demo.staging.<root>` serves the web app and `/api/health` returns 200.

### Checkpoint: Foundation
- [ ] CI green · [ ] isolation test green · [ ] staging reachable · [ ] owner review

## Phase 2: Auth and devices (highest risk)

- [ ] **Task 5: Better Auth login and i18n shell** · M · deps: 3 · FR-A01, FR-A02, NFR-04
  - AC: email/password login, required email verification and reset via Resend; `/login`, `/forgot-password`, `/reset-password` in Arabic (RTL) and English with next-intl; SPF/DKIM/DMARC set on the sending domain.
  - Verify: register a seeded user, verify email, log in, reset password on staging in both languages.

- [ ] **Task 6: MFA for staff** · S · deps: 5 · FR-A03
  - AC: TOTP enrolment forced for teacher, assistant and super admin before any `/manage` or admin page.
  - Verify: a staff user without TOTP is redirected to enrolment; with TOTP, login requires a code.

- [ ] **Task 7: NestJS auth and access guards** · M · deps: 5 · FR-T03
  - AC: guards for session, user status, membership status, `paused_roles`, role; failures return the `reason` codes from system design §3.
  - Verify: tests for each reason code; suspended user and paused role get 403 with the right code.

- [ ] **Task 8: Device binding and one-session login** · L · deps: 7 · FR-D01–D04, D07, D08
  - AC: login algorithm from `05-auth-devices.md §3` inside one transaction with row lock; device cookie set on parent domain; every student request checks device cookie = `session.device_id`.
  - Verify: tests for first login binds; second browser → `DEVICE_LIMIT`; second approved device while first is signed in → `SESSION_ON_OTHER_DEVICE`; two parallel logins → only one session; same device on another tenant → allowed.

- [ ] **Task 9: Device-change and sign-out requests** · M · deps: 8 · FR-D03, D05, D06
  - AC: `/blocked` screens with both request actions (password re-check, rate-limited); pending device cookie; `/manage/requests` with approve and reject; approval revokes the old device or sessions as specified.
  - Verify: end-to-end on staging with two browsers: request → approve → new browser logs in, old one is out.

- [ ] **Task 10: Staff device and session actions** · S · deps: 8 · FR-D02, D06, FR-L01
  - AC: revoke device, force sign-out, change `max_devices`, suspend membership; each writes an audit entry.
  - Verify: tests that each action ends sessions and logs the audit entry.

### Checkpoint: Auth and devices
- [ ] All device and session tests green · [ ] manual two-browser test on staging · [ ] owner review

## Phase 3: Access

- [ ] **Task 11: Courses CRUD** · S · deps: 7
  - AC: create, edit, publish, archive, soft-delete courses; teacher-only delete.
  - Verify: API tests incl. tenant isolation; list page in `/manage/courses`.

- [ ] **Task 12: Invitations and enrollments** · M · deps: 8, 11 · FR-E01, E03, E04, A05, A06
  - AC: create, resend, revoke invitations; `/join` validates on GET and redeems only on POST in one transaction; existing users accept after login; guardian consent stored.
  - Verify: tests for expired, reused, revoked and wrong-email tokens; parallel redeem → one success.

- [ ] **Task 13: Access codes** · M · deps: 12 · FR-E02, E03
  - AC: batch generation with CSV shown once; HMAC storage; register-with-code and redeem-in-account; revoke batch.
  - Verify: tests for double redeem in parallel, revoked code, rate limit.

- [ ] **Task 14: Students, enrollment removal, payments** · M · deps: 12 · FR-E05, E06
  - AC: students list and detail; add course; terminate enrollment (teacher, super admin) with SSE-ready event hook; payments create and list (assistant view-only).
  - Verify: terminated student gets 403 on course content; payment permissions tested per role.

- [ ] **Task 15: Super admin site** · M · deps: 7 · FR-T02–T05
  - AC: `admin.<root>` with tenant list and usage, create tenant, pause any mix of roles, suspend users, soft delete.
  - Verify: pausing students ends their sessions and shows `TENANT_PAUSED`; teacher still works.

### Checkpoint: Access
- [ ] A real student can be invited or use a code, log in on one device, and be removed · [ ] owner review

## Phase 4: Content

- [ ] **Task 16: R2 uploads** · M · deps: 11 · FR-C03
  - AC: presign and confirm endpoints; MIME and size allow-list; pending cleanup job.
  - Verify: upload a PDF and an MP4 on staging; disallowed type rejected; object lands under `tenants/{id}/`.

- [ ] **Task 17: Course tree editor** · L · deps: 16 · FR-C01, C02
  - AC: create, rename, move (dnd-kit), reorder, publish, soft-delete, restore; depth ≤ 5; attach assets.
  - Verify: tests for move cycles and depth limit; manual drag-and-drop in Arabic and English.

- [ ] **Task 18: Student course view and documents** · M · deps: 17, 14 · FR-C04, C06
  - AC: `/learn/courses/...` with tree and viewer; PDF.js for PDFs; downloads only when allowed; unpublished items hidden.
  - Verify: non-enrolled student gets 403; view-only file has no download URL in the API response.

- [ ] **Task 19: Video playback and progress** · M · deps: 18 · FR-C05, C07
  - AC: signed URL (4 h) with refresh on 403; moving watermark; progress and resume position saved.
  - Verify: video plays and resumes; watermark shows student name and email.

- [ ] **Task 20: Tenant settings and public site** · M · deps: 16 · FR-T06
  - AC: settings form (branding, social and contact links, pages, locale, timezone, device default); public landing, about, how-it-works; rich text sanitized.
  - Verify: changing the logo and colors updates the site; script tags in pages are stripped.

### Checkpoint: Content
- [ ] Teacher builds a full course and a student studies it on staging · [ ] owner review

## Phase 5: Exams

- [ ] **Task 21: Question banks** · M · deps: 11 · FR-X01
  - AC: global and course banks; single, multiple, true/false editor with marks, difficulty, explanation, tags, image.
  - Verify: CRUD tests and tenant isolation.

- [ ] **Task 22: Quiz builder** · M · deps: 21, 17 · FR-X02, X03
  - AC: settings, targets (course, chapter, lecture nodes), manual and random selection, release modes.
  - Verify: validation tests (close after open, random count ≤ pool size).

- [ ] **Task 23: Attempts and grading** · L · deps: 22, 8 · FR-X04–X06, X10
  - AC: start with snapshot and deadline; autosave; submit and auto-submit after deadline + grace; server grading; attempt tied to device.
  - Verify: tests for answer leak (no `is_correct` in any student response), late answers rejected, max attempts, other-device rejected.

- [ ] **Task 24: Release, results and rescue** · M · deps: 23 · FR-X07–X09
  - AC: four grade-release modes computed on read; review modes and review time; results pages for students and staff; extend time and move-device actions.
  - Verify: tests per release mode incl. the all-submitted fallback at close time.

### Checkpoint: Exams
- [ ] Load test: 300 simulated students start one quiz within a minute on staging · [ ] owner review

## Phase 6: Engagement and launch

- [ ] **Task 25: Notifications and SSE** · M · deps: 7 · FR-N01, N02
  - AC: notifications table, `/api/sse` with in-memory map (max 5 streams per user), bell with unread count; control events trigger `/blocked` or refreshes; Nginx buffering off.
  - Verify: grade release shows in an open tab within 2 s; revoked device is sent to `/blocked` at once.

- [ ] **Task 26: Push and email notifications** · M · deps: 25 · FR-N03
  - AC: FCM token per device, deleted on revoke; push and email for the important types in the user's language.
  - Verify: push arrives with the site closed on Android/desktop Chrome; revoked device gets none.

- [ ] **Task 27: Announcements, Q&A, general support** · M · deps: 25, 18 · FR-N04, N05, C08
  - AC: tenant and course announcements; lesson comments with staff hide/delete; general support requests.
  - Verify: hidden comment invisible to students; announcement creates notifications for enrolled students only.

- [ ] **Task 28: Analytics and audit views** · S · deps: 14, 23 · FR-L01, L02
  - AC: overview numbers with plain SQL; audit log page with filters (teacher, super admin).
  - Verify: numbers match seeded data in a test.

- [ ] **Task 29: Scheduled jobs** · S · deps: 12, 16, 24, 15
  - AC: cleanup of expired invitations and sessions, pending assets, grade-release notifications, 30-day tenant purge; all idempotent.
  - Verify: running each job twice gives the same result in tests.

- [ ] **Task 30: Launch hardening** · M · deps: all
  - AC: security headers and CSP; Sentry on both apps with scrubbing; uptime monitor; nightly `pg_dump` to separate bucket with a rehearsed restore; privacy policy and terms; security checklist in `docs/09-security.md §5` complete.
  - Verify: checklist signed off by the owner; restore rehearsal documented.

### Checkpoint: Launch
- [ ] All SRS MVP requirements met · [ ] production deploy · [ ] first teacher onboarded
