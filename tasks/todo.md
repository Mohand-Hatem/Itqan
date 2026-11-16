# Itqan MVP: phases and steps

Rules: [../CLAUDE.md § Workflow rules](../CLAUDE.md). Brief each step and wait for approval. 🎨 = UI step (follows `docs/11-design.md`). 🔑 = needs credentials in `.env`. Requirement IDs refer to [../docs/02-srs.md](../docs/02-srs.md).

**⏭ = put off by the owner:** not built in Track A; built in Phase 11 right before its page.

**⏸ = waits for the design** ([ADR-010](../docs/adr/010-backend-first-ui-later.md), [docs/12-ui-later.md](../docs/12-ui-later.md)). The design is not chosen yet, so work runs on two tracks:
- **Track A, now:** every step without ⏸, in order, from Phase 4. A step that mixed an API and a page is split: **a** = API and tests (now), **b** = the page (⏸).
- **Track B, after the owner chooses the design:** Phase 11 (UI, frontend and security: Phase 3, then every ⏸ step in order, then the security steps that need real pages), then Phase 12 (preview and launch).

Each phase has an **API checkpoint** (Track A) and a **UI checkpoint** (Phase 11). A phase is complete only when both are green.

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
- [x] **1.9** docker-compose + Nginx routing (`/api/auth/*` and pages → web, `/api/*` → api, SSE buffering off). _Done when:_ the local stack serves both apps on one port.

Staging on the VPS moved to step 10.8: no server or domain is bought until the teacher approves the preview (ADR-009). The staging compose file and scripts stay in the repo for that step.

**Checkpoint 1:** CI green · local Docker stack serves both apps · owner review.

## Phase 2: Database and tenancy (1 week)

- [x] **2.1** PostgreSQL in docker-compose for local work and tests (`itqan` and `itqan_test`, port 5433); `DATABASE_URL` and `TEST_DATABASE_URL` in `.env`. _Done when:_ `npm run db:up` reports healthy and both databases answer `SELECT 1`.
- [x] **2.2** Prisma in `packages/database` with one shared client. _Done when:_ `prisma generate` works, both apps import the client, and an integration test connects to the Docker database.
- [x] **2.3** Base schema: `tenants`, `memberships`, `audit_logs`. _Done when:_ the first migration applies.
- [x] **2.4** Request context (AsyncLocalStorage) and tenant resolver from `Host` with a 60 s cache (FR-T01). _Done when:_ an unknown host returns 404.
- [x] **2.5** Prisma tenant extension that injects `tenant_id` on reads and writes. _Done when:_ unit tests show the filter applied.
- [x] **2.6** Tenant isolation test harness with two tenant fixtures (NFR-01). _Done when:_ the test proves tenant A cannot read or write B's rows.
- [x] **2.7** Seed script: first tenant and super admin placeholder. _Done when:_ `npm run db:seed` runs clean twice.
- [x] **2.8** Audit log service (FR-L01). _Done when:_ a test writes and reads an entry.
- [x] **2.9** 🔑 Neon project with a `dev` branch (`DATABASE_URL` pooled, `DIRECT_URL`) and `prisma migrate deploy` promotion from Docker to Neon `dev`. _Done when:_ Neon `dev` is migrated after all tests pass on Docker Postgres.

**Checkpoint 2:** isolation tests green · owner review.

## Phase 3: Design system and app shell (1.5 weeks) ⏸ paused until the design is chosen

Track B. Runs first when the owner says the design is chosen; 3.3 and 3.6 are frontend shell work, so they wait with the rest.

- [ ] **3.1** 🎨⏸ **Design gate:** the owner teaches the design method. _Done when:_ the method is written in `docs/11-design.md` and approved.
- [ ] **3.2** 🎨⏸ Design tokens (color, type, spacing, radius) with per-tenant brand variables. _Done when:_ tokens drive Tailwind and change per tenant.
- [ ] **3.3** 🎨⏸ Arabic and Latin fonts, next-intl with `ar` (default) and `en`, RTL (NFR-04). _Done when:_ switching language flips the direction correctly.
- [ ] **3.4** 🎨⏸ shadcn/ui with base components themed. _Done when:_ a component page renders correctly in RTL and LTR.
- [ ] **3.5** 🎨⏸ Layouts: public, student (`/learn`), staff (`/manage`), super admin. _Done when:_ each shell navigates.
- [ ] **3.6** ⏸ Host-based middleware (tenant vs admin host) and branding loader. _Done when:_ tenant name, logo and colors apply.
- [ ] **3.7** 🎨⏸ Loading, empty, error, 404 and blocked pages. _Done when:_ each exists in both languages.
- [ ] **3.8** ⏸ Accessibility and responsive audit of the shell (NFR-05). Runs as step 11.7 over all pages. _Done when:_ the `impeccable` audit shows no critical issues.

**Checkpoint 3 (Track B):** shell reviewed on phone and desktop · owner review.

## Phase 4: Authentication (1.5 weeks)

- [x] **4.1** 🔑 Better Auth in `packages/auth` with the Prisma adapter; `BETTER_AUTH_SECRET`. _Done when:_ auth tables migrate.
- [x] **4.2** Next.js route handler `/api/auth/*` behind Nginx. _Done when:_ sign-in works with curl on the local stack.
- [x] **4.3** 🔑 Resend with its test sender (no domain yet; verified domain in step 10.9) and email templates in Arabic and English, in a plain readable layout (branded styling waits for the design). _Done when:_ a test email reaches the owner's inbox.
- [x] **4.4** Email verification and password reset (FR-A01, FR-A02). _Done when:_ both flows work with curl on the local Docker stack, following the emailed links.
- [ ] **4.5** 🎨⏸ Login, forgot-password and reset-password pages. _Done when:_ they work in both languages.
- [x] **4.6** TOTP MFA enforced for staff and super admin (FR-A03). _Done when:_ staff without TOTP are sent to enrolment (API returns the enrolment-required reason).
- [x] **4.7** NestJS session guard using the shared auth instance. _Done when:_ requests without a session get 401.
- [x] **4.8** Access guards: user status, membership status, paused roles, role, with reason codes (FR-T03). _Done when:_ a test covers each reason code.
- [x] **4.9a** `GET /me` (user, memberships, roles, tenant). _Done when:_ an integration test returns the signed-in user and 401 without a session.
- [ ] **4.9b** 🎨⏸ Frontend auth context with TanStack Query. _Done when:_ layouts show the signed-in user.
- [x] **4.10** Rate limits on auth endpoints. _Done when:_ tests hit each limit.

**API checkpoint 4:** login, reset and MFA work with curl and integration tests on the local Docker stack · owner review.
**UI checkpoint 4 (Phase 11):** the same flows work in the browser in both languages.

## Phase 5: Devices and sessions (1.5 weeks)

- [x] **5.1** Spike: can Better Auth run our check before creating a session? _Done when:_ the choice (hook or custom endpoint) is recorded as the next ADR.
- [x] **5.2** `devices` table, extra session fields, device cookie helpers (hash, constant-time compare). _Done when:_ unit tests pass.
- [x] **5.3** Login algorithm in one transaction with a row lock (FR-D01–D04, D07, D08). _Done when:_ tests pass for first-bind, `DEVICE_LIMIT`, `SESSION_ON_OTHER_DEVICE`, parallel logins, and same device on another tenant.
- [x] **5.4** Per-request device guard. _Done when:_ a copied session cookie without the device cookie fails.
- [ ] **5.5** 🎨⏸ Blocked screens with reason messages. _Done when:_ every reason shows the right message in both languages.
- [x] **5.6** `support_requests` table and device-change request with pending device cookie (FR-D03). _Done when:_ a request is created through the API with the reason code a blocked login returns.
- [x] **5.7** Sign-out-other-device request (FR-D05). _Done when:_ a request is created through the API with the reason code a blocked login returns.
- [x] **5.8a** Requests API: list, approve, reject (FR-D06). _Done when:_ an integration test with two separate sessions passes the full flow (blocked login → request → approve → login works).
- [ ] **5.8b** 🎨⏸ `/manage/requests` page. _Done when:_ a Playwright test with two browsers passes the full flow.
- [x] **5.9** Staff actions: revoke device, force sign-out, `max_devices`, suspend membership, all audited. _Done when:_ tests show sessions end and audit entries exist.
- [x] **5.10a** API: a student lists their own devices. _Done when:_ an integration test returns only the caller's devices.
- [ ] **5.10b** 🎨⏸ Student devices page. _Done when:_ the student sees their own devices.

**API checkpoint 5:** anti-sharing rules proven with two separate sessions in integration tests on the local Docker stack · owner review.
**UI checkpoint 5 (Phase 11):** the same rules proven with two real browsers.

## Phase 6: Access and people (2 weeks)

- [x] **6.1** Courses API (create, edit, publish, archive, soft delete; teacher-only delete). _Done when:_ API and isolation tests pass.
- [ ] **6.2** 🎨⏸ Course list and course form. _Done when:_ staff manage courses in the UI.
- [x] **6.3** Invitations API: create, resend, revoke, check, register, accept, with atomic redemption (FR-E01, E03), including guardian consent fields (FR-A06). _Done when:_ tests pass for expired, reused, revoked, wrong email and parallel redeem.
- [ ] **6.4** 🎨⏸ `/join` page with guardian consent (FR-A06). _Done when:_ a new student registers from an email link.
- [x] **6.5** Access code batches: generate, CSV shown once, revoke (FR-E02). _Done when:_ tests pass and stored codes are hashed.
- [x] **6.6a** Register-with-code and redeem-in-account API. _Done when:_ a parallel double-redeem test gives one success.
- [ ] **6.6b** 🎨⏸ Register-with-code and redeem pages. _Done when:_ a student registers with a code in the browser.
- [x] **6.7** Enrollments: add and terminate (teacher, super admin) (FR-E04, E05). _Done when:_ a terminated student gets 403 on course content.
- [x] **6.8a** Students list and detail API (courses, devices, sessions, grades, payments). _Done when:_ API and isolation tests pass.
- [ ] **6.8b** 🎨⏸ Students list and detail pages. _Done when:_ staff can find and manage a student.
- [ ] **6.9a** ⏭ Payments API; assistants view-only (FR-E06). Put off by the owner on 2026-11-13; built in Phase 11 (step 11.2) right before 6.9b. _Done when:_ permission tests pass per role.
- [ ] **6.9b** 🎨⏸ Payments page. _Done when:_ the teacher records a payment in the UI and an assistant can only view.
- [x] **6.10a** Assistant management API (teacher only). _Done when:_ tests show the teacher adds and removes an assistant and others get 403.
- [ ] **6.10b** 🎨⏸ Assistant management page. _Done when:_ the teacher adds and removes an assistant in the UI.
- [x] **6.11a** Super admin API: tenant list with usage, create tenant (FR-T02, T05). _Done when:_ a new tenant's host resolves in an integration test.
- [ ] **6.11b** 🎨⏸ Super admin tenant pages. _Done when:_ a new tenant subdomain works from the UI.
- [x] **6.12a** Super admin API: pause roles, suspend users, soft delete (FR-T03, T04). _Done when:_ pausing students ends their sessions and the teacher still works.
- [ ] **6.12b** 🎨⏸ Super admin pause, suspend and delete pages. _Done when:_ each action works from the UI and asks for confirmation.

**API checkpoint 6:** a student can join by invitation or code, log in on one device, and be removed, all through the API · owner review.
**UI checkpoint 6 (Phase 11):** a real student does the same in the browser.

## Phase 7: Content and media (2.5 weeks)

- [x] **7.1** 🔑 R2 buckets (private, public), API keys and CORS. _Done when:_ a presigned PUT works with curl and a CORS preflight from the web origin passes (the browser upload is checked in 7.3).
- [x] **7.2** Upload API: presign, confirm, MIME and size allow-list, `media_assets` (FR-C03). _Done when:_ tests pass and disallowed types are rejected.
- [ ] **7.3** 🎨⏸ Upload component with progress. _Done when:_ a 500 MB MP4 uploads to R2 from the local Docker stack.
- [x] **7.4** Content tree API: create, rename, move, reorder, publish, soft delete, restore, depth ≤ 5 (FR-C01, C02). _Done when:_ tests pass for cycles and depth.
- [ ] **7.5** 🎨⏸ Tree editor with drag and drop. _Done when:_ the teacher builds a course tree in both languages.
- [x] **7.6** Content access API: signed URLs after enrollment and publish checks, URL refresh (FR-C06). _Done when:_ a non-enrolled student gets 403 and view-only files get no download URL.
- [ ] **7.7** 🎨⏸ Student course page: tree and viewer layout. _Done when:_ a student navigates a course.
- [ ] **7.8** 🎨⏸ PDF viewer and download policy (FR-C04). _Done when:_ view-only PDFs show no download button.
- [ ] **7.9** 🎨⏸ Video player with URL refresh and moving watermark (FR-C05). _Done when:_ a long video plays past URL expiry and shows the watermark.
- [x] **7.10** Progress tracking and resume (FR-C07). _Done when:_ an API test saves a position and returns it as the resume point.
- [x] **7.11** Tenant settings API with Zod schema and HTML sanitizing (FR-T06). _Done when:_ script tags are stripped in a test.
- [ ] **7.12** 🎨⏸ Settings page and public pages (landing, about, how-it-works). _Done when:_ changing branding updates the public site.

**API checkpoint 7:** through the API, a teacher builds a full course and a student gets its content on the local Docker stack · owner review.
**UI checkpoint 7 (Phase 11):** the same in the browser, including a 500 MB upload and video playback.

## Phase 8: Exams (2.5 weeks)

- [x] **8.1** Question banks and questions API (FR-X01). _Done when:_ CRUD and isolation tests pass.
- [ ] **8.2** 🎨⏸ Question editor. _Done when:_ all three question types can be created.
- [x] **8.3** Quiz API: settings, targets, manual and random selection (FR-X02, X03). _Done when:_ validation tests pass.
- [ ] **8.4** 🎨⏸ Quiz builder. _Done when:_ the teacher creates a scheduled quiz.
- [x] **8.5** Attempt start: selection, shuffle, snapshot, deadline, device tie (FR-X05, X10). _Done when:_ tests pass for the window, max attempts and other-device rejection.
- [x] **8.6** Autosave and linear navigation rules (FR-X04). _Done when:_ late and out-of-order answers are rejected.
- [x] **8.7** Submit, auto-submit after deadline, server grading (FR-X06). _Done when:_ grading tests pass for all types.
- [x] **8.8** Answer-leak test suite. _Done when:_ no student response contains correct answers before release.
- [ ] **8.9** 🎨⏸ Exam-taking page with server-timed countdown and autosave status. _Done when:_ a full attempt works in both languages.
- [x] **8.10** Grade release and review modes (FR-X07, X08). _Done when:_ a test covers each mode, including the all-submitted fallback.
- [ ] **8.11** 🎨⏸ Results pages for students and staff. _Done when:_ each sees the right level of detail.
- [x] **8.12** Rescue actions: extend time, move attempt to a new device (FR-X09). _Done when:_ both are audited and tested.
- [x] **8.13** Load test: 300 students start one quiz within a minute (NFR-03). _Done when:_ p95 is under target on the local Docker stack (Docker Postgres), run alone with `npm run test:load`.

**API checkpoint 8:** a full exam runs end to end through the API on the local Docker stack · owner review.
**UI checkpoint 8 (Phase 11):** a real exam runs end to end in the browser.

## Phase 9: Notifications and engagement (1.5 weeks)

- [x] **9.1** Notifications table and service: row written in the transaction, email and push sent after commit (FR-N01). _Done when:_ tests pass.
- [x] **9.2** SSE endpoint with in-memory map, 5 streams per user, control events (FR-N02). _Done when:_ a test client receives `device_revoked` at once when its device is revoked.
- [ ] **9.3** 🎨⏸ Bell and notifications page. _Done when:_ a grade release appears in an open tab within 2 s.
- [ ] **9.4** 🔑⏸ Firebase project, FCM web push, service worker, tokens per device (FR-N03). Waits because push needs a service worker in the browser. _Done when:_ push arrives with the site closed and stops after the device is revoked.
- [x] **9.5** Email notifications for important types in both languages. _Done when:_ each type sends the right email.
- [x] **9.6a** Announcements API, tenant-wide or per course (FR-N04). _Done when:_ only enrolled students get course announcements.
- [ ] **9.6b** 🎨⏸ Announcements pages. _Done when:_ staff post and students read announcements in the UI.
- [x] **9.7a** Lesson Q&A API with staff hide and delete (FR-C08). _Done when:_ hidden posts are invisible to students.
- [ ] **9.7b** 🎨⏸ Lesson Q&A under the lesson. _Done when:_ a student asks and staff answer in the UI.
- [x] **9.8a** General support requests API (FR-N05). _Done when:_ a student opens one and staff answer it through the API.
- [ ] **9.8b** 🎨⏸ Support requests pages. _Done when:_ the same flow works in the UI.
- [x] **9.9a** Analytics overview API with plain SQL (FR-L02). _Done when:_ numbers match seeded data in a test.
- [ ] **9.9b** 🎨⏸ Analytics overview page. _Done when:_ the page shows the seeded numbers.
- [x] **9.10a** Audit log API with filters. _Done when:_ a test filters by actor, action and date.
- [ ] **9.10b** 🎨⏸ Audit log page with filters. _Done when:_ the teacher filters by actor, action and date.
- [x] **9.11** Phase 9 fixes from the review: paused roles apply at once; SSE streams close when their device is revoked or their session ends, and a full write buffer no longer drops a stream; grade release, course access and device-request decisions create notifications and emails (FR-N03); lint clean; load test runs alone. _Done when:_ `npm test`, `npm run lint`, `npm run typecheck` and `npm run test:load` all pass.

**API checkpoint 9:** notifications work through SSE, the API and email · owner review.
**UI checkpoint 9 (Phase 11):** notifications work online, offline (push) and by email.

## Phase 10: Launch preparation, backend (Track A)

Everything here runs before the design is chosen. Phase 10 closes after 10.5 with its own commit (`phase-10-completed`).

- [x] **10.1** Scheduled jobs: cleanup, grade-release and exam-opening notifications, pending uploads, 30-day tenant purge (`apps/api/src/jobs/`, docs/03 §6). _Done when:_ running each job twice gives the same result.
- [x] **10.2a** Security headers on the API (`helmet`) and Nginx (HSTS on HTTPS, nosniff, Referrer-Policy, Permissions-Policy, no server version), CORS removed (same origin). _Done when:_ `npm run headers:check` passes on the local Docker stack and an API test checks the headers.
- [x] **10.3** `security-audit` skill run and fixes. Run itqan-run-1 stopped by the owner after wave 1 as a partial pass (report: `C:\Users\Mohand\security-audit-skill\itqan\run-1\REPORT.md`, 14 unvalidated leads); the leads are proven with Docker tests and fixed here. Fixed with regression tests: secret fallbacks fail closed in production (auth secret, dedicated access-code key, compose env); review opens at close time by default; removing an assistant no longer signs out other tenants' staff; nginx forwarding headers on every route and Better Auth keys on X-Real-IP (also fixes SSE through the gateway); staff TOTP enforced (403 `MFA_ENROLMENT_REQUIRED`); email HTML escaping; upload allow-list own keys; Q&A follows the publish gate; CSV formula neutralizing; bounded tenant cache; 5 tries per 15 min per access code. Disproved by test: tenant purge RESTRICT block. Accepted by the owner: per-email limit on device and sign-out requests. _Done when:_ each lead the owner chose to fix has a passing regression test, and no open high lead remains.
- [x] **10.4** Dependency audit and secret scanning in CI: new `security` job (`npm audit` with no moderate+ in production dependencies and no high+ anywhere; gitleaks v8.24.2 over the full git history), `permissions: contents: read`, CI also runs on `phase-*` branches; minimatch pinned >= 11.0.1 through `overrides` (Dependabot alert). _Done when:_ both are green (locally: 0 vulnerabilities, 32 commits and the uncommitted work scanned with no leaks; on GitHub: the security job on the phase-10 push).
- [x] **10.5** Privacy policy and terms, with legal review for minors: drafts in Arabic (binding) and English in `docs/legal/`, following Saudi Arabia's Personal Data Protection Law, written from the system's real behaviour; open choices marked [TO CONFIRM]. The lawyer review is required before 12.7. _Done when:_ both are written.

- [x] **10.6** API documentation: one OpenAPI file for every route (NestJS and Better Auth) with request bodies from the Zod schemas, Swagger UI at `/api/docs` in development only, `npm run openapi:export` writing `docs/api/openapi.json` for Apidog and Postman, and a current README. _Done when:_ the file imports into Apidog or Postman, a test proves it is in sync with the code and every write route has a body, and the full suite passes.

**Checkpoint 10:** jobs, headers, the audit fixes, CI scans and the legal pages are done; full test suite green · owner review.

## Phase 11: UI, frontend and security (Track B, after the design is chosen)

Everything left behind for the design, plus the security work that needs the real pages. Starts when the owner says the design is chosen (rule 6, ADR-010). Each step keeps the step gate: brief, approval, build, tests.

- [ ] **11.1** 🎨⏸ Design gate and app shell: Phase 3, steps 3.1 to 3.7, in order (design method, tokens, fonts and RTL, components, layouts, host middleware and branding, state pages).
- [ ] **11.2** 🎨⏸ Every waiting page from Phases 4 to 9, in their original order, each on its finished API: 4.5, 4.9b, 5.5, 5.8b, 5.10b, 6.2, 6.4, 6.6b, 6.8b, 6.9a and 6.9b (payments API and page), 6.10b, 6.11b, 6.12b, 7.3, 7.5, 7.7, 7.8, 7.9, 7.12, 8.2, 8.4, 8.9, 8.11, 9.3, 9.4, 9.6b, 9.7b, 9.8b, 9.9b, 9.10b. _Done when:_ each step's own _Done when_ passes.
- [ ] **11.3** ⏸ Content-Security-Policy for the web pages (nonce-based; self + R2 + Firebase + Sentry + the design's font and script sources). (was 10.2b) Waits for 9.4; the Sentry domain is added when 12.5 adds Sentry. _Done when:_ a CSP scan of every page passes with no violations in the browser console.
- [ ] **11.4** ⏸ UI items found while building the backend: the "Found during Track A" list in [docs/12-ui-later.md](../docs/12-ui-later.md) (blocked screens, TOTP enrolment on `MFA_ENROLMENT_REQUIRED`, reacting to `device_revoked` and `session_terminated`). _Done when:_ every row is built and ticked there.
- [ ] **11.5** Security backlog: the owner picks which items of [security-backlog.md](security-backlog.md) to fix now; each fix gets a regression test, the rest are marked accepted with a reason. _Done when:_ every item is ticked or accepted.
- [ ] **11.6** UI checkpoints of Phases 4 to 9: each phase's browser check (listed under each phase above) passes with real browsers. _Done when:_ all six are green.
- [ ] **11.7** ⏸ Step 3.8: accessibility and responsive audit over every page (NFR-05). _Done when:_ the `impeccable` audit shows no critical issues.
- [ ] **11.8** (was 10.11a) Full standard `security-audit` run over the finished app (backend and UI), before production. Starts from itqan-run-1's ledger: its 3 deferred units (Better Auth account and two-factor endpoints, attempt routes after access is revoked, pre-auth email cost) and a re-check of every 10.3 fix and of [security-backlog.md](security-backlog.md). _Done when:_ the run is complete (all phases, final-clean critic) with no open high findings.

**Checkpoint 11:** every page built and checked in the browser, security backlog closed, full audit clean · owner review.

## Phase 12: Preview and launch

Needs Phase 11 done: the preview and production need real pages and a clean audit.

- [ ] **12.1** (was 10.6) 🔑 Teacher preview: Vercel (web), Render free Docker service (API), Neon `dev`; Next.js rewrites for `/api/*`, `PREVIEW_TENANT_SLUG` fallback, host-only device cookie (ADR-009). _Done when:_ the main teacher and student flows work on the preview link, and a test proves the fallback is off in production.
- [ ] **12.2** (was 10.7) Teacher demo on the preview. _Done when:_ the teacher approves going live, or the feedback is added as new steps.
- [ ] **12.3** (was 10.8) 🔑 Buy the VPS and root domain; Cloudflare wildcard DNS and origin certificate; VPS staging with `docker-compose.staging.yml` and the deploy scripts. _Done when:_ `https://demo.staging.<root>/api/health` returns 200.
- [ ] **12.4** (was 10.9) 🔑 Resend verified sending domain (SPF, DKIM, DMARC). _Done when:_ a test email lands in the inbox, not spam.
- [ ] **12.5** (was 10.10) 🔑 Sentry on both apps with scrubbing, plus an uptime monitor (NFR-07). _Done when:_ a test error appears in Sentry with no secrets.
- [ ] **12.6** (was 10.11) 🔑 Nightly `pg_dump` to a separate R2 bucket and a restore rehearsal (NFR-06). _Done when:_ a restore is documented.
- [ ] **12.6a** Legal review of `docs/legal/` (privacy policy and terms, Arabic and English) by a lawyer qualified in Saudi law; every [TO CONFIRM] filled in (operator legal name, contact, data regions, transfer basis, guardian consent proof, liability). _Done when:_ the lawyer signs off and no [TO CONFIRM] remains.
- [ ] **12.7** (was 10.12) 🔑 Production: Neon `main`, production stack on the VPS, DNS; preview shut down. _Done when:_ production health checks pass.
- [ ] **12.8** (was 10.13) Onboard the first teacher and run a smoke test. _Done when:_ the teacher, one assistant and one student complete the main flows.

**Checkpoint 12:** all MVP requirements in the SRS met · launched.
