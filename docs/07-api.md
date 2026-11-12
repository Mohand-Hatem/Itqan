# REST API (NestJS)

Base path `/api`. Tenant comes from the host. JSON. Errors: `{ "error": { "code": "DEVICE_LIMIT", "message": "…" } }`. Lists use `?cursor=&limit=`. The live contract is the Swagger UI at `/api/docs` (staging only); this file is the plan.

Roles: **SA** super admin, **T** teacher, **A** assistant, **S** student, **P** public.

Every non-public request from a student must also carry the device cookie of the device its session was opened on, and that device must be active; otherwise 403 `DEVICE_NOT_REGISTERED` ([05 §8](05-auth-devices.md)). A session from `/sign-in/student` is accepted only on the tenant it was opened on (403 `NO_ACCESS` elsewhere).

## Auth and devices
| Method | Path | Who | Purpose |
|---|---|---|---|
| * | `/api/auth/*` | P | Better Auth (served by Next.js) |
| POST | `/api/auth/sign-in/student` | P | Student login with device rules ([05 §3](05-auth-devices.md), ADR-011). Body `{ email, password }`; tenant from `Host`. 403 `{ code }`: `DEVICE_LIMIT`, `SESSION_ON_OTHER_DEVICE`, `USER_SUSPENDED`, `NO_ACCESS`, `TENANT_PAUSED`, `USE_STAFF_SIGN_IN`, `EMAIL_NOT_VERIFIED`; 404 `TENANT_NOT_FOUND`; 5/min per IP. |
| GET | `/me` | any | User, membership, tenant branding, permissions |
| GET | `/me/devices` | S | Own devices (step 5.10a). 200 `{ items: [{ id, name, userAgent, status: "active" \| "pending", lastSeenAt, createdAt, current }] }`, newest first; `current` marks the device this session is on. Revoked devices are not listed (staff see them on the student detail). Devices belong to the user, so every tenant subdomain returns the same list. Staff get 403 `ROLE_FORBIDDEN`. |
| POST | `/device-requests` | P (password re-check) | Request device change ([05 §5](05-auth-devices.md)). Body `{ email, password, message? }`. 201 `{ requestId, status: "open" }` and sets the device cookie of a new pending device; the same browser asking again gets the same request. 401 wrong password; 403 the login reasons (`USER_SUSPENDED`, `NO_ACCESS`, `TENANT_PAUSED`, `USE_STAFF_SIGN_IN`, `EMAIL_NOT_VERIFIED`); 409 `DEVICE_REQUEST_NOT_NEEDED` (a login would not hit the limit) or `REQUEST_ALREADY_OPEN` (another browser already asked); 429 over 3/hour per email or 10/hour per IP. |
| POST | `/signout-requests` | P (password re-check) | Request sign-out of other device ([05 §6](05-auth-devices.md)). Body `{ email, password, message? }`. 201 `{ requestId, status: "open" }`; asking again returns the open request. Sets no cookie and creates no device. 401 wrong password; 403 the login reasons; 409 `SIGN_OUT_REQUEST_NOT_NEEDED` (no other device has an open session) or `DEVICE_LIMIT` (this browser would still be blocked by the limit: use `/device-requests`); 429 over 3/hour per email or 10/hour per IP. Approval (5.8a) deletes all of the student's sessions. |
| GET | `/sse` | any | Event stream |
| POST | `/push-tokens` | any | Register FCM token for current device |

## Tenant admin (super admin site)
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/admin/tenants` | SA | List with usage / create |
| PATCH | `/admin/tenants/:id` | SA | Name, slug, `paused_roles` |
| DELETE | `/admin/tenants/:id` | SA | Soft delete |
| PATCH | `/admin/users/:id` | SA | Suspend / reactivate user |

## Settings
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/public/settings` | P | Branding and public pages only |
| GET/PATCH | `/settings` | T | Full tenant settings |

## People
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/students` | T, A | Search and filter |
| GET | `/students/:membershipId` | T, A | Profile, enrollments, devices, sessions, grades |
| PATCH | `/students/:membershipId` | T, A | Body `{ status?: "active" \| "suspended", maxDevices?: 1–10 }` (step 5.9). Suspending ends the student's sessions on this tenant only. `maxDevices` is teacher and SA only (FR-D02; assistants get 403 `ROLE_FORBIDDEN`) and never revokes devices. 200 `{ membershipId, status, maxDevices }`; 404 for staff memberships and other tenants. Audited. |
| POST | `/students/:membershipId/enrollments` | T, A | Add course |
| DELETE | `/enrollments/:id` | T, SA | Terminate |
| POST | `/devices/:id/revoke` | T, A | Revoke a device of a student of this tenant: `revoked`, its sessions end (step 5.9). 200 `{ id, status: "revoked" }`, also when already revoked; 404 otherwise. Audited. |
| POST | `/students/:membershipId/force-signout` | T, A | End all the student's sessions on every tenant; devices stay (step 5.9). By membership, not user id, so it only reaches this tenant's students. 200 `{ membershipId, sessionsEnded }`. Audited. |
| GET/POST/DELETE | `/assistants` | T | Manage assistants |

## Access
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/invitations` | T, A | List / create |
| POST | `/invitations/:id/resend` · `/revoke` | T, A | |
| GET | `/invitations/check?token=` | P | Validate (does not consume) |
| POST | `/invitations/accept` | S | Existing user accepts |
| POST | `/register` | P | Register with invitation |
| POST | `/register-with-code` | P | Register with code |
| POST | `/code-batches` | T, A | Generate codes, returns CSV once |
| GET | `/code-batches` · `/:id/codes` | T, A | Status (redeemed / not) |
| POST | `/code-batches/:id/revoke` | T, A | Revoke unredeemed |
| POST | `/codes/redeem` | S | Existing user redeems |
| GET/POST | `/payments` | T (A view) | Records |

## Content
| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/courses` | T, A (S: own) | |
| GET/PATCH/DELETE | `/courses/:id` | T, A (delete: T) | |
| GET | `/courses/:id/tree` | T, A, S | Tree (students: published only) |
| POST | `/content-items` | T, A | Create node |
| PATCH | `/content-items/:id` | T, A | Rename, move, reorder, publish |
| DELETE / POST `…/restore` | `/content-items/:id` | T, A | Soft delete / restore |
| POST | `/uploads` · `/uploads/:id/confirm` | T, A | Presigned upload |
| GET | `/content-items/:id/access` | S, T, A | Signed URL + watermark |
| PUT | `/progress/:itemId` | S | Completed, video position |
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
