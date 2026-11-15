# Security backlog (Phase 11)

Hardening notes from the 10.3 security audit (run itqan-run-1, report in `C:UsersMohandsecurity-audit-skillitqan
un-1REPORT.md`). They are **not** confirmed vulnerabilities: each is a smaller weakness or a defence-in-depth gap found while reviewing. Step 11.5 picks which to fix; the full audit in step 11.8 re-checks them. Tick an item when it is fixed with a test, or mark it _accepted_ with the reason.

Some notes overlap with what 10.3 already fixed (secret fallbacks, compose env, nginx forwarding headers, rate-limit IP, staff TOTP, email escaping): step 11.5 starts by ticking those after a quick check.

## Not reviewed yet (first work for the full audit, step 11.8)

- [ ] Better Auth account and two-factor endpoints: change-password, update-session, update-user, list and revoke sessions, two-factor disable and backup codes, unverified sign-up squatting.
- [ ] Attempt routes after access ends: answering, submitting and reviewing after an enrollment is terminated or the course or quiz is deleted.
- [ ] Pre-auth email cost: sign-up, verification and reset emails and register-with-code emails, versus the shared Resend quota.

## Accepted by the owner (10.3)

- Device-change and sign-out requests keep the 3 per hour per-email limit: it stops password guessing through these routes; a stranger can use up a student's attempts for an hour (student asks staff in person).
- register-with-code keeps its 409 USER_ALREADY_EXISTS; scanning is limited to 5 tries per 15 min per code.

## Super admin on the admin host (hunter-w1-17)

- [ ] apps/api/src/audit/audit.service.ts record(): when a super admin changes tenant data from the admin host, the audit row gets tenantId null because the callers do not pass entry.tenantId. Affected calls include CoursesService.update and delete, CodeBatchesService.revoke, InvitationsService.revoke and resend, and QuestionBanksService.update and delete. The affected tenant's teacher audit log is scoped by tenantId, so it never shows these changes. EnrollmentsService.terminate already passes tenantId: enrollment.tenantId; do the same in the other unguarded methods, or require a tenant context for writes to tenant data.
- [ ] Unguarded writes to tenant data on the admin host can link rows across tenants because the scoped client passes admin context through. QuestionBanksService.update looks up input.courseId unscoped, so a bank in tenant A can be attached to a course in tenant B. CoursesService create and update store thumbnailAssetId with no ownership check; there is no foreign key and nothing reads it yet, so no sink exists today. Only a super admin can trigger these. Fix: call getTenantId() at the start of every write to tenant data, as quizzes.service.ts already does, or check that the referenced row's tenantId matches.
- [ ] InvitationsService.resend on the admin host builds the emailed link from the admin Host header (joinLink(host, token)), so the invitee gets a link to admin.<root>. This is a functional defect. Build the link from the invitation's tenant slug instead of the request Host.
- [ ] AccessGuard returns true at the end for a request with no context; today only the 'health' exclusion reaches that line. Throw there instead, so a future exclusion or a misconfigured route cannot skip the membership and role checks.

## Notifications and live updates (SSE) (hunter-w1-09)

- [ ] apps/api/src/notifications/sse.service.ts: no process-wide cap on open SSE streams (only 5 per user) and nginx holds /api/sse for 24 h; each authenticated member can pin 5 sockets plus Node buffers. Consider a global/per-tenant cap and an idle/max-age reconnect.
- [ ] apps/api/src/notifications/sse.service.ts: writeEvent ignores res.write() backpressure, so a client that stops reading accumulates queued heartbeats and events in the Node writable buffer until the socket closes; consider dropping the connection when writableLength exceeds a small threshold.
- [ ] apps/api/src/notifications/sse.service.ts: sweepEndedSessions is started by setInterval without an in-flight guard and issues one findMany with an IN list of every tracked session id; with many streams or a slow DB, sweeps can overlap. Consider skipping a tick while a sweep is running and chunking the id list.
- [ ] apps/api/src/notifications/sse.service.ts: streams are re-checked only against session existence/expiry, not membership status, tenant pause or enrollment; current emitters only address notifications to the recipient themselves and announcement fan-out filters active status, so no leak was found, but a future staff-targeted notification type would continue to reach a removed staff member whose global session (tenantId null) is not deleted.
- [ ] packages/shared/src/schemas/announcements.ts: CreateAnnouncementSchema.body has no max length (bounded only by the Express JSON body limit); staff-only, but a cap would bound stored row size and per-announcement work.

## Other (wildcard review) (hunter-w1-15)

- [ ] apps/api/src/me/me.service.ts getMe returns the current tenant's raw settings JSON (including defaultMaxDevices, branding asset ids and any legacy or hand-edited keys not in TenantSettingsSchema) to every active member, while PublicSettingsResponse deliberately omits the device limit and asset ids. Return readTenantSettings() output or the PublicSettingsResponse shape for non-staff roles.
- [ ] apps/api/src/health/health.controller.ts exposes process uptime anonymously on every host; drop uptime or keep it internal if restart timing should not be observable.
- [ ] packages/shared/src/schemas/tenant.ts TenantSlugSchema reserves nothing beyond the 'admin' host check in parseHost; consider rejecting 'www', 'api', 'mail' and similar labels at tenant creation so a tenant cannot occupy an operational subdomain (only super admins create tenants).

## Exams and attempts (hunter-w1-07)

- [ ] saveAnswer checks submittedAt outside any transaction; an upsert racing finalizeAttempt can change selectedOptionIds after grading, leaving review showing a selection that does not match isCorrect/marksAwarded (score unchanged). Re-check submittedAt in the upsert transaction or with a conditional write.
- [ ] saveAnswer, submit and getReview do not re-run enrollments.checkAccess or recheck quiz deletedAt/publishedAt; a student whose enrollment is revoked mid-attempt can keep answering and submitting until the deadline and can still read review content of the quiz afterwards.
- [ ] getAttempt enforces the device tie only before the nominal deadline (getAnswers uses deadline+grace); during the grace window another registered device of the same student can read question text. Use the same deadline+grace window in both.
- [ ] extendTime evaluates the reopen guard (isReviewReleased) before its transaction; reading the quiz release state inside the transaction would close the check-then-act gap.
- [ ] docs/07-api.md line 93 lists GET /attempts/:id for T and A, but the controller restricts it to student via the class-level @Roles; documentation drift only.

## Students, devices and support requests (hunter-w1-04)

- [ ] apps/api/src/support/support-requests.service.ts close(): POST /support-requests/:id/close accepts device_change and sign_out_other requests, so staff can decide a device request without the reject path's pending-device revocation, and close neither takes the user-row lock nor updates conditionally on status 'open', so a concurrent approve and close can both commit (device activated, request ends 'closed'). Restrict close to type 'general' or route it through lockOpenRequest; the route is also missing from docs/07-api.md.
- [ ] apps/api/src/students/students-access.service.ts forceSignOut() and support-requests.service.ts approve() for sign_out_other delete every session of the user on every tenant, including staff (non-device) sessions of the same user where they are teacher/assistant in another tenant. This matches docs/05 section 7 ('All user sessions deleted'), but it lets an assistant of tenant A end staff sessions in tenant B for a dual-role user; consider limiting to device-bound sessions (deviceId not null).
- [ ] users.max_devices and devices are global (docs/02 FR-D02, docs/04): a teacher of tenant A can raise a shared student's device budget, or revoke that student's devices, for every tenant. Documented design; worth an ADR note if tenants should control their own anti-sharing limit.
- [ ] apps/api/src/support/support-requests.controller.ts POST /support-requests allows teacher and assistant to create 'general' requests, while docs/07-api.md line 103 lists the POST as a student action. Align code or docs.
- [ ] apps/api/src/students/students.service.ts list(): a cursor uuid from another tenant is accepted for positioning (200) while an unknown uuid returns 400 INVALID_CURSOR, a negligible cross-tenant existence oracle for membership ids; checking the cursor row's tenantId first would remove it.

## Staff, admin and audit logs (hunter-w1-08)

- [ ] apps/api/src/audit/audit.service.ts list() returns ip, userAgent and actorUser email; tenant.create/update/delete audit rows are written with the tenant's id (apps/api/src/tenants-admin/admin-tenants.service.ts tenant.create and tenant.update/delete audit calls), so a teacher sees the super admin's email, IP and user agent. Consider omitting ip/userAgent for super-admin actors in tenant audit reads.
- [ ] apps/api/src/quizzes/attempts.service.ts moveDevice deletes the student's sessions on the previous (global) device without a tenantId filter, so a staff member of tenant A also signs the student out of other tenants on that device. Add tenantId: ctx.tenantId to that session.deleteMany.
- [ ] apps/api/src/assistants/assistants.service.ts create() for a new email creates a global account with emailVerified:true and a teacher-chosen password. Mitigated by revokeSessionsOnPasswordReset:true and DeviceGuard (a staff session cannot act as student elsewhere), but sending a set-password link instead of a teacher-known password would remove the pre-account risk.
- [ ] apps/api/src/quizzes/quizzes.service.ts publish/unpublish/delete/getById/list/releaseGrades do not require ctx.kind==='tenant'; on the admin host a super admin acts unscoped across tenants (peer-owned admin-host unit).

## Rate limits and resource use (hunter-w1-12)

- [ ] docs/05-auth-devices.md §10 says sign-in is limited per IP+email and reset/verification per email, but Better Auth's limiter keys only by IP and path; add an email-keyed limiter (or update the doc) once the IP keying is fixed.
- [ ] Better Auth uses the in-memory rate-limit store; with more than one web instance the limits multiply. Fine for the current single-container compose; revisit before scaling out.
- [ ] SSE has a per-user cap (5) but no process-wide cap; consider a global ceiling and per-tenant cap alongside the documented Cloudflare rate limiting.
- [ ] Nginx has no limit_req or explicit client_max_body_size; defaults (1m) apply. An explicit small cap on /api/auth/ and /api/ would make the bound visible.
- [ ] Behind Cloudflare, Express trust proxy (private ranges only) makes req.ip the Cloudflare edge address, so the Nest per-IP throttler buckets on device and sign-out requests would be shared across users; the trust-proxy/nginx boundary itself is peer-owned.

## Scheduled jobs (hunter-w1-11)

- [ ] failStalePendingUploads deletes the R2 object before claiming the row (pending->failed). If confirm() HEADs the object and flips it to ready between the job's findMany and its updateMany, the asset ends up ready with no object. Claim the row first (updateMany where pending), then delete the object only when count === 1. No cross-tenant or authorization impact (apps/api/src/jobs/jobs.service.ts:175-185).
- [ ] notifyExamOpenings and notifyGradeReleases do not check course.deletedAt (or course status). Students enrolled in a soft-deleted course still get an 'exam is open' or 'grade available' notification and email for a quiz they can no longer start (checkAccess rejects deleted courses). Add course: { deletedAt: null } to both due queries (apps/api/src/jobs/jobs.service.ts:58,105).
- [ ] notifyGradeReleases notifies every membership with a submitted attempt, including suspended memberships and terminated enrollments. Only the quiz title is disclosed, but this could be filtered the same way as the exam-opening eligibility (membership active).
- [ ] Global users and devices of a purged tenant are kept by design (test asserts this). If FR-T04 should also cover users who belonged only to that tenant, that needs a documented decision; it is not a finding as specified.

## Tenant isolation and data references (hunter-w1-03)

- [ ] apps/api/src/courses/courses.service.ts:31 and :117 store input.thumbnailAssetId with no scoped mediaAsset check, and schema.prisma:382 gives it no relation or FK. Nothing reads it today, but whichever step resolves thumbnails to signed URLs will inherit a value that can point at another tenant's asset. Check it the way content-items checkAsset does (scoped findFirst, status ready) or make it a relation.
- [ ] Every tenant foreign key in packages/database/prisma/schema.prisma is single-column (for example Enrollment.courseId, QuizQuestion.questionId, ContentItem.assetId). The array columns Invitation.courseIds, Quiz.randomBankIds and AttemptAnswer.selectedOptionIds have no FK at all. Cross-tenant references are blocked only by per-service validation, which held at every write site reviewed. Composite (tenant_id, id) FKs or the planned Postgres RLS would make this hold structurally.
- [ ] apps/api/src/invitations/invitations.service.ts:337 (check) reads courses through systemPrisma by inv.courseIds without tenantId: inv.tenantId. It is safe today only because the ids were validated when the invitation was created. Add the tenant filter, as register/accept already do at lines 428 and 535.
- [ ] packages/auth/src/student-sign-in.ts:23 creates its own tenant-lookup cache in the web process, and the API never invalidates it after a rename or delete. That leaves a staleness window of up to 60 s per process, and there is no cross-replica invalidation if the API is scaled out. No cross-tenant effect was found, because DeviceGuard rejects a session whose tenant does not match the Host.
- [ ] apps/api/src/enrollments/enrollments.service.ts:161-181: when a super admin on tenant host A terminates an enrollment of tenant B, the update runs outside a transaction on systemPrisma. Then audit.record writes through the scoped client with explicit tenantId B, and scopeCreateData throws TENANT_MISMATCH. The enrollment ends up terminated with no audit entry. Only super admins can trigger it, so no lower-trust principal gains anything. Fix by wrapping both writes in one systemPrisma transaction and passing it as tx.

## Comments, settings and emails (hunter-w1-10)

- [ ] comments.service.ts:71-76 accepts a reply to a hidden parent comment, and list (line 159) hides only the hidden comment itself, so replies under a hidden question stay visible to students; consider checking parent.hiddenAt and filtering replies of hidden parents.
- [ ] comments.service.ts update/delete do not re-check enrollment, so a student whose enrollment ended can still edit or delete their own comments (own data only).
- [ ] joinLink (apps/api/src/invitations/join-link.ts) reuses the raw Host header including any client-supplied port; building the link from the resolved tenant slug and configured root domain would remove the caller-chosen port and case.
- [ ] User name has no length or character limit on Better Auth sign-up/update-user; it later appears in comment author.name and the video watermark. Output escaping is deferred to the UI (ADR-010); a server-side max length would bound stored size.

## Cross-component and public lookups (hunter-w1-16)

- [ ] docker-compose.yml passes BETTER_AUTH_SECRET and BETTER_AUTH_URL only to web and PLATFORM_ROOT_DOMAIN only to api; apps/api/Dockerfile loads no env file. As written the api's Better Auth instance runs on the hard-coded fallback secret and http://localhost:3000 baseURL (cannot verify web-signed session cookies; mints verification JWTs from register-with-code that web will reject), and web's /sign-in/student throws in production without PLATFORM_ROOT_DOMAIN. Fails closed today; give both services the same three variables and make the fallback secret throw when NODE_ENV=production.
- [ ] NestJS state-changing @Public routes (codes/redeem, invitations/accept) rely only on the Better Auth session cookie's SameSite=Lax; sibling tenant subdomains are same-site. No sibling script surface exists yet (no product pages), so this is not exploitable now; consider an Origin/Sec-Fetch-Site check in the API once pages ship.
- [ ] packages/auth/src/student-sign-in.ts keeps its own 60 s tenant cache in the web process that admin pause/delete cannot invalidate, so student sign-in can mint sessions for up to 60 s after a tenant is paused or deleted; the API middleware still 404s those tenant routes.
- [ ] GET /invitations/check does not bind the invitation to the Host tenant (InvitationsService.check uses systemPrisma by token only); harmless with a 256-bit token, but binding to the Host tenant would keep register/accept on the tenant that issued the link.

## Content, uploads and storage (hunter-w1-06)

- [ ] Presigned PUT URLs stay valid for 15 minutes after POST /uploads/:id/confirm marks an asset ready; the uploader can overwrite the object with different bytes of the same signed type and length after the HEAD check. Consider shortening expiry or comparing ETag at access time (apps/api/src/uploads/uploads.service.ts, apps/api/src/storage/storage.service.ts).
- [ ] Upload bytes are never inspected: confirm checks only the declared Content-Type header and size, so an 'image/png' public asset may hold arbitrary bytes. Consider setting X-Content-Type-Options: nosniff on the R2 public domain (Cloudflare transform rule) and magic-byte checks for images.
- [ ] courses.thumbnail_asset_id has no FK and CoursesService.create/update accepts any UUID without a scoped ready/public asset check (apps/api/src/courses/courses.service.ts). No reader resolves it today; add the same check SettingsService.checkAssets uses before a thumbnail URL is ever rendered.
- [ ] Staff GET /content-items/:id/access does not re-check that the parent course is not soft-deleted (apps/api/src/content-items/content-access.service.ts); same-tenant staff only.
- [ ] Student presigned GET URLs are bearer links not bound to the student and remain valid after enrollment termination for up to 5 minutes (documents) or 4 hours (video); docs/06-flows.md and docs/09-security.md accept this, so it is not a finding.

## Secrets and literal checks (hunter-w1-14)

- [ ] Fail closed in production for BETTER_AUTH_SECRET and ACCESS_CODE_HMAC_SECRET, as getRootDomain already does for PLATFORM_ROOT_DOMAIN, and add both variables to the compose api service. ACCESS_CODE_HMAC_SECRET is also missing from .env.example.
- [ ] Under docker-compose.yml the api process gets no BETTER_AUTH_SECRET while web does. Better Auth signs session cookies with its secret, so the API's getSession would reject every cookie the web signed with a different key. This breaks function rather than security, but it signals that the compose env is incomplete (R2 variables are missing from the api service too).
- [ ] Session cookie Secure flag and __Secure- prefix depend on BETTER_AUTH_URL being https (better-auth cookies/index.mjs line 23); auth.ts defaults to http://localhost:3000 and compose to http://localhost:8080. Set advanced.useSecureCookies in production or require an https BETTER_AUTH_URL.
- [ ] Falling back from ACCESS_CODE_HMAC_SECRET to BETTER_AUTH_SECRET reuses one key for two purposes; derive separate keys or require a dedicated one.
- [ ] .dockerignore does not exclude .env, and both Dockerfiles run `COPY . .` in the builder stage, so the root .env enters builder layers and the build context (peer-owned Docker build-context unit; noted only).

## Sign-in, sessions and recovery (hunter-w1-01)

- [ ] /sign-in/student returns the raw session token in the JSON body (student-sign-in.ts line 168); there is no bearer plugin, so it is not directly usable, but it puts an HttpOnly-protected credential where page script can read it. Consider omitting it.
- [ ] Password reset revokes sessions but not devices; an attacker device created with a stolen student password keeps the only device slot (maxDevices 1), so the owner needs a support device-change request after recovery.
- [ ] /change-password leaves other sessions alive unless the client sends revokeOtherSessions=true; consider forcing it server-side via a hook.
- [ ] trustedOrigins lists only localhost origins; production tenant subdomains rely on BETTER_AUTH_URL alone, so cross-subdomain auth POSTs will be origin-rejected (fails closed). Configure from PLATFORM_ROOT_DOMAIN.
- [ ] The compose web service gets no PLATFORM_ROOT_DOMAIN, so getRootDomain() throws under NODE_ENV=production and /sign-in/student fails closed (availability only).

## Guards and cookies (hunter-w1-02)

- [ ] AccessGuard ends with 'return true' when no request context exists (apps/api/src/auth/access.guard.ts:138); only the @Public health route lacks a context today, but a future middleware exclusion would open authenticated routes to any signed-in user. Throw 403 instead.
- [ ] Nest has no Origin or Sec-Fetch-Site check; cookie-authenticated bodyless POSTs (e.g. /api/quizzes/:id/publish, /api/devices/:id/revoke, /api/students/:membershipId/force-signout, /api/code-batches/:id/revoke) are simple requests that SameSite=Lax does not block from same-site sibling subdomains (other tenants, admin host). No attacker-controlled sibling origin exists in source today; add an Origin allow-list check for unsafe methods before tenant pages or a same-site file domain ship.
- [ ] @Public routes POST /api/codes/redeem and /api/invitations/accept consume req.user attached by SessionGuard without DeviceGuard, so a copied student session cookie without the device cookie can act there (effect limited to the session owner's own account).
- [ ] DeviceGuard trusts that a device-bound session's user stays a student on its tenant; this rests on the memberships (tenantId,userId) unique constraint and on roles never being updated in place. A role-change feature would need DeviceGuard to reject device-bound sessions on staff memberships.
- [ ] Tenant lookup cache (packages/database/src/tenant-lookup.ts) is per-process; invalidate() on delete only reaches the instance that served the admin request. Fine for one API instance, revisit if scaled horizontally.

## Invitations, codes and enrollments (hunter-w1-05)

- [ ] apps/api/src/invitations/invitations.service.ts:554 and apps/api/src/code-batches/code-redemption.service.ts:387-395 reactivate a terminated enrollment but leave terminatedAt and terminatedBy set (grant at enrollments.service.ts:88-89 clears them); clear both fields so audit and analytics do not show an active enrollment as terminated.
- [ ] apps/api/src/enrollments/enrollments.service.ts:153-181: terminate checks status, then updates and writes the audit entry outside a transaction; a failed audit write leaves an unaudited termination and concurrent calls double-audit. Use updateMany WHERE status='active' plus the audit write in one transaction (CLAUDE.md: transactions for multi-record writes).
- [ ] docs/06-flows.md:46 says termination emits SSE enrollment_terminated; EnrollmentsService.terminate emits nothing. Access checks read the database live, so this is a contract gap, not a bypass.
- [ ] /codes/redeem and /invitations/accept are @Public (code-redemption.controller.ts:49, invitations.controller.ts:100) though docs/07-api.md lists them as S routes, so they skip DeviceGuard tenant/device binding and AccessGuard paused-role checks. Effects are same-principal (joining a tenant with one's own code or mailed token), but a service-level pausedRoles check and a device-bound-session tenant check would match the rule in docs/07-api.md:7.
- [ ] registerWithCode (code-redemption.service.ts:83-141), like the open sign-up, lets anyone create an unverified account for an arbitrary email. requireEmailVerification and revokeSessionsOnPasswordReset (packages/auth/src/auth.ts:59-61) contain pre-account takeover, but a squatted email consumes a paid code and blocks the real owner's /register until they reset the password.
- [ ] maxDevices is a global user field set from the first joined tenant's defaultMaxDevices (settings/default-max-devices.ts, used at code-redemption.service.ts:139 and invitations.service.ts:404); joining a second tenant via /codes/redeem or /invitations/accept keeps the first tenant's limit (up to 5). This matches the documented global identity (FR-D02), but the owner should confirm that a stricter tenant is meant to inherit another tenant's device policy.
- [ ] InvitationsService.resend (invitations.service.ts:177-248) refreshes an expired invitation without the duplicate-active check that create applies (lines 59-73), so one email can hold two live invitations; low impact since both are staff-issued for the same tenant.

## Deployment, CI and supply chain (hunter-w1-13)

- [ ] Add a top-level `permissions: contents: read` to .github/workflows/ci.yml, and pin the actions and the service and base images (actions/*, docker/*, postgres:18-alpine, node:22-alpine, nginx:alpine) by digest.
- [ ] Add .env, .env.*, nginx/certs, .claude, .mcp.json, .playwright-mcp, .impeccable and screens to .dockerignore. Today the builder stage of both images receives the root .env and any Cloudflare origin key; they are not shipped in the runner stage but stay in the local build cache.
- [ ] The nginx /api/sse and /api/notifications/stream locations also lose the server-level headers. Host becomes api_upstream, so TenantMiddleware returns 404 for SSE through the gateway (functional break, fail-closed), and locally req.ip there comes from the client's X-Forwarded-For.
- [ ] Behind Cloudflare, nginx appends the Cloudflare edge address as the last X-Forwarded-For hop, so Express req.ip (and the Nest throttler on device and sign-out requests) is keyed on Cloudflare edge IPs that many users share. Add real_ip handling for the Cloudflare ranges.
- [ ] docker-compose.yml does not pass PLATFORM_ROOT_DOMAIN to the web service, so getRootDomain() throws under NODE_ENV=production on the /sign-in/student path (functional break). Better Auth trustedOrigins and BETTER_AUTH_URL default to localhost values for staging.
- [ ] The local gateway publishes ${GATEWAY_PORT:-8080} on all interfaces; bind it to 127.0.0.1 for local development.
- [ ] The staging nginx HTTP-to-HTTPS redirect and the TLS server answer any Host or IP (a single default server). Add a default_server that returns 444 for unknown names, and restrict origin access to Cloudflare.
