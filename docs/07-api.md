# REST API (NestJS)

Base path `/api`. Tenant comes from the host. JSON. Errors: `{ "statusCode": 403, "reason": "DEVICE_LIMIT", "message": "…" }`; the UI picks its text from `reason`. Two exceptions: Better Auth routes under `/api/auth/*` answer `{ "code": "…" }`, and an unknown host answers 404 `{ "error": { "code": "TENANT_NOT_FOUND" } }` from the tenant middleware. Lists use `?cursor=&limit=`. The live contract is the Swagger UI at `/api/docs` (outside production only), built from `apps/api/src/openapi/operations.ts` with access lines generated from the guards (10R.8); this file is the plan; per-step details for Phase 6 are in `docs/designs/`.

Roles: **SA** super admin, **T** teacher, **A** assistant, **S** student, **P** public.

Every non-public request from a student must also carry the device cookie of the device its session was opened on, and that device must be active; otherwise 403 `DEVICE_NOT_REGISTERED` ([05 §8](05-auth-devices.md)). A session from `/sign-in/student` is accepted only on the tenant it was opened on (403 `NO_ACCESS` elsewhere).

Rows marked 10R.x are added or changed in Phase 10R of [../tasks/todo.md](../tasks/todo.md). Two reasons apply to many routes from then on: 403 `PASSWORD_CHANGE_REQUIRED` on every route except `GET /me` while the user must change their password ([05 §1b](05-auth-devices.md)), and 403 `GUARDIAN_CONSENT_REQUIRED` on student content and attempt routes for a minor without consent ([06 §10](06-flows.md)).

## Auth and devices
| Method | Path | Who | Purpose |
|---|---|---|---|
| * | `/api/auth/*` | P | Better Auth (served by Next.js). Kept and switched-off routes: [05 §1d](05-auth-devices.md). No `/two-factor/*` or `/mfa/status` after 10R.2. |
| POST | `/api/auth/sign-in/student` | P | Student login with device rules ([05 §3](05-auth-devices.md), ADR-011). Body `{ email, password }`; tenant from `Host`. 403 `{ code }`: `DEVICE_LIMIT`, `SESSION_ON_OTHER_DEVICE`, `USER_SUSPENDED`, `NO_ACCESS`, `TENANT_PAUSED`, `USE_STAFF_SIGN_IN`, `EMAIL_NOT_VERIFIED`; 404 `TENANT_NOT_FOUND`; 5/min per IP. |
| GET | `/me` | any | User, membership, tenant branding, permissions. From 10R.2/10R.3 the user carries `mustChangePassword` instead of `twoFactorEnabled`; from 10R.7, `guardianConsent: "not_required" \| "required" \| "pending" \| "given"`. Always answers, even while a password change is required. |
| POST | `/me/guardian-consent/request` | S | (10R.7) Ask a guardian for consent by email. Body `{ guardianName, relationship: "parent" \| "legal_guardian" \| "other", guardianEmail }` (must differ from the student's email). 201 `{ id, status: "pending", expiresAt }` (no token); 400 `GUARDIAN_EMAIL_SAME_AS_STUDENT`; 409 `CONSENT_ALREADY_GIVEN` or `CONSENT_NOT_REQUIRED`; 429 `CONSENT_REQUEST_LIMIT` over 3/hour. |
| GET | `/me/devices` | S | Own devices (step 5.10a). 200 `{ items: [{ id, name, userAgent, status: "active" \| "pending", lastSeenAt, createdAt, current }] }`, newest first; `current` marks the device this session is on. Revoked devices are not listed (staff see them on the student detail). Devices belong to the user, so every tenant subdomain returns the same list. Staff get 403 `ROLE_FORBIDDEN`. |
| POST | `/device-requests` | P (password re-check) | Request device change ([05 §5](05-auth-devices.md)). Body `{ email, password, message? }`. 201 `{ requestId, status: "open" }` and sets the device cookie of a new pending device; the same browser asking again gets the same request. 401 wrong password; 403 the login reasons (`USER_SUSPENDED`, `NO_ACCESS`, `TENANT_PAUSED`, `USE_STAFF_SIGN_IN`, `EMAIL_NOT_VERIFIED`); 409 `DEVICE_REQUEST_NOT_NEEDED` (a login would not hit the limit) or `REQUEST_ALREADY_OPEN` (another browser already asked); 429 over 3/hour per email or 10/hour per IP. |
| POST | `/signout-requests` | P (password re-check) | Request sign-out of other device ([05 §6](05-auth-devices.md)). Body `{ email, password, message? }`. 201 `{ requestId, status: "open" }`; asking again returns the open request. Sets no cookie and creates no device. 401 wrong password; 403 the login reasons; 409 `SIGN_OUT_REQUEST_NOT_NEEDED` (no other device has an open session) or `DEVICE_LIMIT` (this browser would still be blocked by the limit: use `/device-requests`); 429 over 3/hour per email or 10/hour per IP. Approval (5.8a) deletes all of the student's sessions. |
| GET | `/sse` | any | Event stream, at most 5 per user. Events: `connected`, `notification.created`, `device_revoked`, `session_terminated`. A stream is closed by the server when its device is revoked or its session ends (checked every 25 s) |
| POST | `/push-tokens` | any | Register FCM token for current device |

## Tenant admin (super admin site)
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/admin/tenants` | SA | List with usage / create with its first teacher. From 10R.4 the first teacher is created like any direct account (unverified, must change password); from 10R.5 tenant responses carry `teachers: [{ id, name, email, status }]`, `assistantCount` and `studentCount` instead of `teacher`. |
| PATCH | `/admin/tenants/:id` | SA | Name, slug, `paused_roles` |
| DELETE | `/admin/tenants/:id` | SA | Soft delete |
| PATCH | `/admin/users/:id` | SA | Suspend / reactivate user. From 10R.5: 409 `LAST_TEACHER` when suspending the last active teacher of any tenant. From 10R.7 the body is `{ status?, isMinor? }` (at least one); an `isMinor` change is audited as `user.minor_flag_change`. |
| POST | `/admin/users/:id/password` | SA | (10R.3) Set a new password. Body `{ newPassword }` (12+ for staff, 8+ for students). Sets `must_change_password`, ends all the user's sessions, keeps devices, audited without the password. 200 `{ sessionsEnded }`; 403 for a super admin target (use bootstrap recovery). |
| GET | `/admin/tenants/:id/members` | SA | (10R.5) `?role=teacher,assistant,student&status=&q=&cursor=&limit=` (default roles teacher and assistant). Items `{ membershipId, userId, name, email, role, status, userStatus, emailVerified, mustChangePassword, createdAt }`, `nextCursor`. |
| POST | `/admin/tenants/:id/members` | SA | (10R.4) Direct creation of any role, or link an existing account (no password needed then). Body `{ email, name?, role, password?, isMinor?, courseIds?, requirePasswordChange? }`. 201 `{ membershipId, userId, role, existingUserLinked, mustChangePassword }`; 409 `MEMBERSHIP_ALREADY_EXISTS`. Audited. |
| PATCH | `/admin/tenants/:id/members/:membershipId` | SA | (10R.5) `{ role?: "teacher" \| "assistant", status?: "active" \| "suspended" }`. Students cannot be re-roled. 409 `LAST_TEACHER`. Audited. |
| DELETE | `/admin/tenants/:id/members/:membershipId` | SA | (10R.5) Remove a teacher or assistant. 409 `LAST_TEACHER`. Staff sessions end only if it was their last staff role. Audited. |
| POST | `/admin/tenants/:id/invitations` | SA | (10R.6) Invite any role into this tenant. Same body and rules as `POST /invitations`. |

## Settings
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/public/settings` | P | `{ name, branding: { logoUrl, faviconUrl, primaryColor, secondaryColor }, hero: { title, subtitle, imageUrl }, pages, contact, social, locale, timezone }`. No device limit, no asset ids |
| GET/PATCH | `/settings` | T | Full tenant settings (`TenantSettingsSchema` in `packages/shared`) plus `urls`. PATCH takes `name` and any part (`branding`, `hero`, `pages`, `contact`, `social`, `locale`, `timezone`, `defaultMaxDevices`); a part sent replaces that whole part. Page HTML is cleaned with `sanitize-html` on save. Images must be ready public images of the tenant (400 `ASSET_NOT_USABLE`). Audit `tenant.settings_update` |

## People
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/students` | T, A | Search and filter |
| POST | `/students` | T, A | (10R.4) Create a student account directly. Body `{ name, email, password (8+), phone?, isMinor, courseIds?, requirePasswordChange? (default true) }`. 201 `{ userId, membershipId, enrollmentIds, status: "active", emailVerified: false, mustChangePassword, guardianConsent }`. No email is sent. 409 `USE_INVITATION` (the email already has an account) or `MEMBERSHIP_ALREADY_EXISTS`; 404 `COURSE_NOT_FOUND`. Audited, never with the password. |
| POST | `/students/:membershipId/guardian-consent` | T, A | (10R.7) Record offline consent. Body `{ guardianName, relationship, obtainedOn, evidenceReference, notes? }` (reference only, no files). 201; 409 `CONSENT_ALREADY_GIVEN`. Audited. |
| POST | `/students/:membershipId/guardian-consent/request` | T, A | (10R.7) Send the guardian the consent email for this student. Same body and limits as `/me/guardian-consent/request`. |
| POST | `/students/:membershipId/guardian-consent/withdraw` | T, A | (10R.7) Record a withdrawal the guardian asked for. Access closes in every academy. Audited. |
| GET | `/students/:membershipId` | T, A | Profile, enrollments, devices, sessions, grades |
| PATCH | `/students/:membershipId` | T, A | Body `{ status?: "active" \| "suspended", maxDevices?: 1–10 }` (step 5.9). Suspending ends the student's sessions on this tenant only. `maxDevices` is teacher and SA only (FR-D02; assistants get 403 `ROLE_FORBIDDEN`) and never revokes devices. 200 `{ membershipId, status, maxDevices }`; 404 for staff memberships and other tenants. Audited. |
| POST | `/students/:membershipId/enrollments` | T, A | Add course |
| DELETE | `/enrollments/:id` | T, SA | Terminate |
| GET | `/courses/:id/access` | S | Whether the caller has an active enrollment in the course (step 6.7) |
| POST | `/devices/:id/revoke` | T, A | Revoke a device of a student of this tenant: `revoked`, its sessions end (step 5.9). 200 `{ id, status: "revoked" }`, also when already revoked; 404 otherwise. Audited. |
| POST | `/students/:membershipId/force-signout` | T, A | End all the student's sessions on every tenant; devices stay (step 5.9). By membership, not user id, so it only reaches this tenant's students. 200 `{ membershipId, sessionsEnded }`. Audited. |
| GET/POST | `/assistants` | T | List / add an assistant (step 6.10a). From 10R.4: a new account only, created directly (password 12+, unverified, must change password); an email that already has an account gets 409 `USE_INVITATION` (invite them with `role: "assistant"` instead). |
| DELETE | `/assistants/:id` | T | Remove an assistant. Their sessions on this tenant end. Their staff sessions (which carry no tenant) end only if this was their last active staff role and they are not a super admin, so one tenant cannot sign out another tenant's staff (step 10.3). Access to this tenant ends at once either way. Audited. |

## Access
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/invitations` | T, A | List / create. From 10R.6 the body takes `role` (default `student`): the teacher may invite `assistant` or `student`, the assistant only `student` (403 `ROLE_FORBIDDEN` otherwise); `courseIds` only for students. One email is sent. |
| POST | `/invitations/:id/resend` · `/revoke` | T, A | |
| GET | `/invitations/check?token=` | P | Validate (does not consume). From 10R.6 also returns `role`. |
| POST | `/invitations/accept` | any signed in | Existing account accepts with a session whose email matches. From 10R.6 the email becomes verified, the membership gets the invited role, and a first staff role forces a password change. 409 `MEMBERSHIP_ALREADY_EXISTS` for a staff invitation to a member. |
| POST | `/invitations/accept-with-password` | P | (10R.6) For an account that cannot sign in yet (pending). Body `{ token, password }`: the token proves the mailbox, the account's own password proves the account (never changed). Same result as `/accept`, and a pending account becomes active. 401 `INVALID_EMAIL_OR_PASSWORD`; 10/hour per IP. |
| POST | `/register` | P | Register with invitation. From 10R.6 staff invitations need a 12+ password; from 10R.7 the body takes `isMinor` and an optional `guardian { name, relationship, email }` instead of `guardianConsent`. |
| POST | `/register-with-code` | P | Register with code. From 10R.3 the account is `pending` until the email is verified; from 10R.7 the body takes `isMinor` and an optional `guardian` instead of `guardianConsent`. |
| GET | `/guardian-consent/check?token=` | P | (10R.7) Show the student's name, academy and policy version for a consent link; consumes nothing |
| POST | `/guardian-consent/confirm` | P | (10R.7) Guardian confirms. Body `{ token, guardianName, relationship, agree: true }`. 200; 410 expired or used. |
| POST | `/code-batches` | T | Generate codes, returns CSV once. Codes are never emailed. |
| GET | `/code-batches` · `/:id/codes` | T, A | Status (redeemed / not) |
| POST | `/code-batches/:id/revoke` | T | Revoke unredeemed |
| POST | `/codes/redeem` | S | Existing user redeems. Never asks for guardian consent; the access gate decides ([06 §10](06-flows.md)). |
| GET/POST | `/payments` | T (A view) | Records. Not built yet: step 6.9a is put off until Phase 11 (step 11.2). |

## Content
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/courses` | T, A | Students get their courses in Phase 7 |
| GET/PATCH/DELETE | `/courses/:id` | T, A (delete: T) | |
| GET | `/courses/:id/tree` | T, A, S | Tree. Staff (7.4): live tree, `?deleted=true` lists restorable items. Students (7.6): enrolled, course not a draft; published items under published parents only, `[{id, kind, title, mimeType, children}]` |
| POST | `/content-items` | T, A | Create node `{courseId, parentId?, kind, title, assetId?}` |
| PATCH | `/content-items/:id` | T, A | Rename, move, reorder, publish `{title?, parentId?, position?, published?, assetId?}`. 409 `TREE_CYCLE` / `TREE_TOO_DEEP` |
| DELETE / POST `…/restore` | `/content-items/:id` | T, A | Soft delete of the branch / restore it (409 `PARENT_DELETED`). Details: [designs/phase-7.4](designs/phase-7.4-content-tree-api.md) |
| POST | `/uploads` | T, A | Presigned upload ([06 §4](06-flows.md)). Body `{ fileName, mimeType, size, purpose: "content"\|"public", downloadPolicy? }` (default `view_only`). 201 `{ asset, uploadUrl, expiresAt }`: a pending asset and a 15-minute PUT URL signed for that exact `Content-Type` and `Content-Length`. 400 `UPLOAD_TYPE_NOT_ALLOWED` or `UPLOAD_TOO_LARGE`. |
| POST | `/uploads/:id/confirm` | T, A | Check the stored file (`HEAD`) and mark the asset `ready`; calling it again returns the ready asset. 404 `ASSET_NOT_FOUND`; 409 `UPLOAD_NOT_FOUND` (not uploaded yet) or `UPLOAD_MISMATCH` (size or type differ: the asset is `failed` and the file deleted). |
| PATCH | `/uploads/:id` | T, A | `{ downloadPolicy: "view_only" \| "downloadable" }`, with an audit entry. 404 `ASSET_NOT_FOUND` |
| GET | `/content-items/:id/access` | S, T, A | Signed view/download URLs + video watermark ([designs/phase-7.6](designs/phase-7.6-content-access-api.md)). Students: 403 `ENROLLMENT_REQUIRED` / `ENROLLMENT_TERMINATED` / `COURSE_NOT_PUBLISHED`; 404 for hidden items. Staff may preview unpublished items |
| PUT | `/progress/:itemId` | S | `{ completed?, videoPositionSec? }` (0–86400, videos only). Same checks as `…/access`; completing twice keeps the first time. 400 `NOT_A_VIDEO` / `NOT_TRACKABLE` (folders, chapters, lectures) |
| GET | `/courses/:id/progress` | S | `{ items: [{ itemId, completed, completedAt, videoPositionSec, updatedAt }], resume: { itemId, videoPositionSec } \| null }`: own progress on visible items; `resume` = latest item not completed |
| GET/POST | `/content-items/:id/comments` | S, T, A | Q&A |
| PATCH/DELETE | `/comments/:id` | author, T, A | Edit / hide / delete |

## Exams
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/question-banks` | T, A | |
| GET/POST | `/question-banks/:id/questions` | T, A | |
| PATCH/DELETE | `/questions/:id` | T, A | |
| GET/POST | `/quizzes` | T, A (S: available) | |
| PATCH | `/quizzes/:id` | T, A | Settings, targets, questions |
| POST | `/quizzes/:id/release-grades` | T, A | Manual release |
| GET | `/quizzes/:id/results` | T, A | All attempts |
| POST | `/quizzes/:id/attempts` | S | Start |
| GET | `/attempts/:id` | S (own), T, A | Questions (no answers) or review |
| PUT | `/attempts/:id/answers` | S | Autosave |
| POST | `/attempts/:id/submit` | S | Submit |
| POST | `/attempts/:id/extend` · `/move-device` | T, A | Rescue actions |

## Communication and ops
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/notifications` | any | List; `PATCH /notifications/read` marks read |
| GET/POST | `/announcements` | T, A (S: read) | |
| GET/POST | `/support-requests` | S (own), T, A | Staff `GET` (step 5.8a): `?status=&type=&cursor=&limit=` (default 20, max 100), newest first; `{ items: [{ id, type, status, message, createdAt, decidedAt, student: { membershipId, name, email }, pendingDevice: { id, userAgent, createdAt } \| null }], nextCursor }`. Student list and `POST` (general requests) come with 9.8a. |
| POST | `/support-requests/:id/approve` · `/reject` | T, A (and SA) | Device and sign-out requests ([05 §5–6](05-auth-devices.md)). Approve `device_change`: revokes the least recently used active devices, just enough to make room, ends their sessions, activates the pending device. Approve `sign_out_other`: ends all the student's sessions; devices stay. Reject: a `device_change`'s pending device is revoked. 200 `{ id, status }`; 404 not in this tenant; 409 `REQUEST_NOT_OPEN` (already decided) or `REQUEST_STALE` (pending device gone). Audited. |
| GET | `/audit-logs` | T, SA | Filter by actor, action, date |
| GET | `/analytics/overview` | T, A | Dashboard numbers |
