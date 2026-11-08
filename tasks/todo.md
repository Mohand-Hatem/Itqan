# Itqan MVP: phases and steps

Rules: [../CLAUDE.md § Workflow rules](../CLAUDE.md). Brief each step and wait for approval. 🎨 = UI step (follows `docs/11-design.md`). 🔑 = needs credentials in `.env`. Requirement IDs refer to [../docs/02-srs.md](../docs/02-srs.md).

Each line: **step**, then _Done when_ (the check that proves it works).

## Phase 0: Planning and tooling ✅

- [x] **0.1** Product, requirements and design docs (`docs/`)
- [x] **0.2** ADRs 001–007
- [x] **0.3** GitHub repo `Mohand-Hatem/Itqan`
- [x] **0.4** MCP servers, skills and plugin (`docs/10-dev-setup.md`)
- [x] **0.5** Phases, steps and workflow rules

## Phase 1: Foundation (1 week)

- [x] **1.1** npm workspaces and folder layout (`apps/web`, `apps/api`, `packages/shared`, `packages/database`, `packages/auth`). _Done when:_ `npm install` succeeds at the root.
- [x] **1.2** Shared TypeScript, ESLint and Prettier config. _Done when:_ `npm run lint` and `npm run typecheck` pass.
- [x] **1.3** Scaffold Next.js app (App Router, TypeScript, Tailwind). _Done when:_ the dev server renders a page.
- [x] **1.4** Scaffold NestJS app with `GET /api/health`. _Done when:_ it returns 200.
- [x] **1.5** `packages/shared` with Zod, imported by both apps. _Done when:_ a shared schema validates in web and api.
- [x] **1.6** Test runner (Vitest) with one passing test per app and package. _Done when:_ `npm test` is green.
- [x] **1.7** GitHub Actions CI: lint, typecheck, test, build. _Done when:_ CI is green on push.
- [x] **1.8** Dockerfiles for web and api. _Done when:_ both images build locally.
- [ ] **1.9** docker-compose + Nginx routing (`/api/auth/*` and pages → web, `/api/*` → api, SSE buffering off). _Done when:_ the local stack serves both apps on one port.
- [ ] **1.10** 🔑 Staging on the VPS with Cloudflare wildcard DNS and origin certificate. _Done when:_ `https://demo.staging.<root>/api/health` returns 200.

**Checkpoint 1:** CI green · staging reachable · owner review.

## Phase 2: Database and tenancy (1 week)

- [ ] **2.1** 🔑 Neon project with a dev branch; `DATABASE_URL` and `DIRECT_URL` in `.env`. _Done when:_ Prisma connects.
- [ ] **2.2** Prisma in `packages/database` with one shared client. _Done when:_ `prisma generate` works and both apps import the client.
- [ ] **2.3** Base schema: `tenants`, `memberships`, `audit_logs`. _Done when:_ the first migration applies.
- [ ] **2.4** Request context (AsyncLocalStorage) and tenant resolver from `Host` with a 60 s cache (FR-T01). _Done when:_ an unknown host returns 404.
- [ ] **2.5** Prisma tenant extension that injects `tenant_id` on reads and writes. _Done when:_ unit tests show the filter applied.
- [ ] **2.6** Tenant isolation test harness with two tenant fixtures (NFR-01). _Done when:_ the test proves tenant A cannot read or write B's rows.
- [ ] **2.7** Seed script: first tenant and super admin placeholder. _Done when:_ `npm run db:seed` runs clean twice.
- [ ] **2.8** Audit log service (FR-L01). _Done when:_ a test writes and reads an entry.
- [ ] **2.9** Staging database branch and `prisma migrate deploy` in the deploy flow. _Done when:_ staging is migrated.

**Checkpoint 2:** isolation tests green · owner review.

## Phase 3: Design system and app shell (1.5 weeks)

- [ ] **3.1** 🎨 **Design gate:** the owner teaches the design method. _Done when:_ the method is written in `docs/11-design.md` and approved.
- [ ] **3.2** 🎨 Design tokens (color, type, spacing, radius) with per-tenant brand variables. _Done when:_ tokens drive Tailwind and change per tenant.
- [ ] **3.3** 🎨 Arabic and Latin fonts, next-intl with `ar` (default) and `en`, RTL (NFR-04). _Done when:_ switching language flips the direction correctly.
- [ ] **3.4** 🎨 shadcn/ui with base components themed. _Done when:_ a component page renders correctly in RTL and LTR.
- [ ] **3.5** 🎨 Layouts: public, student (`/learn`), staff (`/manage`), super admin. _Done when:_ each shell navigates.
- [ ] **3.6** Host-based middleware (tenant vs admin host) and branding loader. _Done when:_ tenant name, logo and colors apply.
- [ ] **3.7** 🎨 Loading, empty, error, 404 and blocked pages. _Done when:_ each exists in both languages.
- [ ] **3.8** Accessibility and responsive audit of the shell (NFR-05). _Done when:_ the `impeccable` audit shows no critical issues.

**Checkpoint 3:** shell reviewed on phone and desktop · owner review.

## Phase 4: Authentication (1.5 weeks)

- [ ] **4.1** 🔑 Better Auth in `packages/auth` with the Prisma adapter; `BETTER_AUTH_SECRET`. _Done when:_ auth tables migrate.
- [ ] **4.2** Next.js route handler `/api/auth/*` behind Nginx. _Done when:_ sign-in works with curl on the local stack.
- [ ] **4.3** 🔑 Resend, sending domain (SPF, DKIM, DMARC) and email templates in Arabic and English. _Done when:_ a test email lands in the inbox, not spam.
- [ ] **4.4** Email verification and password reset (FR-A01, FR-A02). _Done when:_ both flows work on staging.
- [ ] **4.5** 🎨 Login, forgot-password and reset-password pages. _Done when:_ they work in both languages.
- [ ] **4.6** TOTP MFA enforced for staff and super admin (FR-A03). _Done when:_ staff without TOTP are sent to enrolment.
- [ ] **4.7** NestJS session guard using the shared auth instance. _Done when:_ requests without a session get 401.
- [ ] **4.8** Access guards: user status, membership status, paused roles, role, with reason codes (FR-T03). _Done when:_ a test covers each reason code.
- [ ] **4.9** `GET /me` and a frontend auth context with TanStack Query. _Done when:_ layouts show the signed-in user.
- [ ] **4.10** Rate limits on auth endpoints. _Done when:_ tests hit each limit.

**Checkpoint 4:** login, reset and MFA work on staging · owner review.

## Phase 5: Devices and sessions (1.5 weeks)

- [ ] **5.1** Spike: can Better Auth run our check before creating a session? _Done when:_ the choice (hook or custom endpoint) is recorded as ADR-009.
- [ ] **5.2** `devices` table, extra session fields, device cookie helpers (hash, constant-time compare). _Done when:_ unit tests pass.
- [ ] **5.3** Login algorithm in one transaction with a row lock (FR-D01–D04, D07, D08). _Done when:_ tests pass for first-bind, `DEVICE_LIMIT`, `SESSION_ON_OTHER_DEVICE`, parallel logins, and same device on another tenant.
- [ ] **5.4** Per-request device guard. _Done when:_ a copied session cookie without the device cookie fails.
- [ ] **5.5** 🎨 Blocked screens with reason messages. _Done when:_ every reason shows the right message in both languages.
- [ ] **5.6** `support_requests` table and device-change request with pending device cookie (FR-D03). _Done when:_ a request is created from the blocked screen.
- [ ] **5.7** Sign-out-other-device request (FR-D05). _Done when:_ a request is created from the blocked screen.
- [ ] **5.8** 🎨 `/manage/requests` with approve and reject (FR-D06). _Done when:_ a Playwright test with two browsers passes the full flow.
- [ ] **5.9** Staff actions: revoke device, force sign-out, `max_devices`, suspend membership, all audited. _Done when:_ tests show sessions end and audit entries exist.
- [ ] **5.10** 🎨 Student devices page. _Done when:_ the student sees their own devices.

**Checkpoint 5:** anti-sharing rules proven with two real browsers on staging · owner review.

## Phase 6: Access and people (2 weeks)

- [ ] **6.1** Courses API (create, edit, publish, archive, soft delete; teacher-only delete). _Done when:_ API and isolation tests pass.
- [ ] **6.2** 🎨 Course list and course form. _Done when:_ staff manage courses in the UI.
- [ ] **6.3** Invitations API: create, resend, revoke, check, register, accept, with atomic redemption (FR-E01, E03). _Done when:_ tests pass for expired, reused, revoked, wrong email and parallel redeem.
- [ ] **6.4** 🎨 `/join` page with guardian consent (FR-A06). _Done when:_ a new student registers from an email link.
- [ ] **6.5** Access code batches: generate, CSV shown once, revoke (FR-E02). _Done when:_ tests pass and stored codes are hashed.
- [ ] **6.6** 🎨 Register with code and redeem in account. _Done when:_ a parallel double-redeem test gives one success.
- [ ] **6.7** Enrollments: add and terminate (teacher, super admin) (FR-E04, E05). _Done when:_ a terminated student gets 403 on course content.
- [ ] **6.8** 🎨 Students list and detail (courses, devices, sessions, grades, payments). _Done when:_ staff can find and manage a student.
- [ ] **6.9** 🎨 Payments API and page; assistants view-only (FR-E06). _Done when:_ permission tests pass per role.
- [ ] **6.10** 🎨 Assistant management (teacher only). _Done when:_ the teacher adds and removes an assistant.
- [ ] **6.11** 🎨 Super admin: tenant list with usage, create tenant (FR-T02, T05). _Done when:_ a new tenant subdomain works.
- [ ] **6.12** 🎨 Super admin: pause roles, suspend users, soft delete (FR-T03, T04). _Done when:_ pausing students ends their sessions and the teacher still works.

**Checkpoint 6:** a real student can join by invitation or code, log in on one device, and be removed · owner review.

## Phase 7: Content and media (2.5 weeks)

- [ ] **7.1** 🔑 R2 buckets (private, public), API keys and CORS. _Done when:_ a presigned PUT works from the browser.
- [ ] **7.2** Upload API: presign, confirm, MIME and size allow-list, `media_assets` (FR-C03). _Done when:_ tests pass and disallowed types are rejected.
- [ ] **7.3** 🎨 Upload component with progress. _Done when:_ a 500 MB MP4 uploads on staging.
- [ ] **7.4** Content tree API: create, rename, move, reorder, publish, soft delete, restore, depth ≤ 5 (FR-C01, C02). _Done when:_ tests pass for cycles and depth.
- [ ] **7.5** 🎨 Tree editor with drag and drop. _Done when:_ the teacher builds a course tree in both languages.
- [ ] **7.6** Content access API: signed URLs after enrollment and publish checks (FR-C06). _Done when:_ a non-enrolled student gets 403 and view-only files get no download URL.
- [ ] **7.7** 🎨 Student course page: tree and viewer layout. _Done when:_ a student navigates a course.
- [ ] **7.8** 🎨 PDF viewer and download policy (FR-C04). _Done when:_ view-only PDFs show no download button.
- [ ] **7.9** 🎨 Video player with URL refresh and moving watermark (FR-C05). _Done when:_ a long video plays past URL expiry and shows the watermark.
- [ ] **7.10** Progress tracking and resume (FR-C07). _Done when:_ a video resumes where the student stopped.
- [ ] **7.11** Tenant settings API with Zod schema and HTML sanitizing (FR-T06). _Done when:_ script tags are stripped in a test.
- [ ] **7.12** 🎨 Settings page and public pages (landing, about, how-it-works). _Done when:_ changing branding updates the public site.

**Checkpoint 7:** the teacher builds a full course and a student studies it on staging · owner review.

## Phase 8: Exams (2.5 weeks)

- [ ] **8.1** Question banks and questions API (FR-X01). _Done when:_ CRUD and isolation tests pass.
- [ ] **8.2** 🎨 Question editor. _Done when:_ all three question types can be created.
- [ ] **8.3** Quiz API: settings, targets, manual and random selection (FR-X02, X03). _Done when:_ validation tests pass.
- [ ] **8.4** 🎨 Quiz builder. _Done when:_ the teacher creates a scheduled quiz.
- [ ] **8.5** Attempt start: selection, shuffle, snapshot, deadline, device tie (FR-X05, X10). _Done when:_ tests pass for the window, max attempts and other-device rejection.
- [ ] **8.6** Autosave and linear navigation rules (FR-X04). _Done when:_ late and out-of-order answers are rejected.
- [ ] **8.7** Submit, auto-submit after deadline, server grading (FR-X06). _Done when:_ grading tests pass for all types.
- [ ] **8.8** Answer-leak test suite. _Done when:_ no student response contains correct answers before release.
- [ ] **8.9** 🎨 Exam-taking page with server-timed countdown and autosave status. _Done when:_ a full attempt works in both languages.
- [ ] **8.10** Grade release and review modes (FR-X07, X08). _Done when:_ a test covers each mode, including the all-submitted fallback.
- [ ] **8.11** 🎨 Results pages for students and staff. _Done when:_ each sees the right level of detail.
- [ ] **8.12** Rescue actions: extend time, move attempt to a new device (FR-X09). _Done when:_ both are audited and tested.
- [ ] **8.13** Load test: 300 students start one quiz within a minute (NFR-03). _Done when:_ p95 is under target on staging.

**Checkpoint 8:** a real exam runs end to end on staging · owner review.

## Phase 9: Notifications and engagement (1.5 weeks)

- [ ] **9.1** Notifications table and service: row written in the transaction, email and push sent after commit (FR-N01). _Done when:_ tests pass.
- [ ] **9.2** SSE endpoint with in-memory map, 5 streams per user, control events (FR-N02). _Done when:_ a revoked device is sent to `/blocked` at once.
- [ ] **9.3** 🎨 Bell and notifications page. _Done when:_ a grade release appears in an open tab within 2 s.
- [ ] **9.4** 🔑 Firebase project, FCM web push, service worker, tokens per device (FR-N03). _Done when:_ push arrives with the site closed and stops after the device is revoked.
- [ ] **9.5** Email notifications for important types in both languages. _Done when:_ each type sends the right email.
- [ ] **9.6** 🎨 Announcements, tenant-wide or per course (FR-N04). _Done when:_ only enrolled students get course announcements.
- [ ] **9.7** 🎨 Lesson Q&A with staff hide and delete (FR-C08). _Done when:_ hidden posts are invisible to students.
- [ ] **9.8** 🎨 General support requests (FR-N05). _Done when:_ a student opens one and staff answer it.
- [ ] **9.9** 🎨 Analytics overview with plain SQL (FR-L02). _Done when:_ numbers match seeded data in a test.
- [ ] **9.10** 🎨 Audit log page with filters. _Done when:_ the teacher filters by actor, action and date.

**Checkpoint 9:** notifications work online, offline and by email · owner review.

## Phase 10: Hardening and launch (1.5 weeks)

- [ ] **10.1** Scheduled jobs: cleanup, grade-release notifications, pending uploads, 30-day tenant purge. _Done when:_ running each job twice gives the same result.
- [ ] **10.2** Security headers and CSP. _Done when:_ a header scan passes.
- [ ] **10.3** 🔑 Sentry on both apps with scrubbing, plus an uptime monitor (NFR-07). _Done when:_ a test error appears in Sentry with no secrets.
- [ ] **10.4** 🔑 Nightly `pg_dump` to a separate R2 bucket and a restore rehearsal (NFR-06). _Done when:_ a restore is documented.
- [ ] **10.5** Full `security-audit` skill run and fixes. _Done when:_ no open high findings.
- [ ] **10.6** Dependency audit and secret scanning in CI. _Done when:_ both are green.
- [ ] **10.7** Privacy policy and terms, with legal review for minors. _Done when:_ both are published.
- [ ] **10.8** 🔑 Production: Neon production project, production stack on the VPS, DNS. _Done when:_ production health checks pass.
- [ ] **10.9** Onboard the first teacher and run a smoke test. _Done when:_ the teacher, one assistant and one student complete the main flows.

**Checkpoint 10:** all MVP requirements in the SRS met · launched.
