# REST API (NestJS)

Base path `/api`. Tenant comes from the host. JSON. Errors: `{ "error": { "code": "DEVICE_LIMIT", "message": "…" } }`. Lists use `?cursor=&limit=`. The live contract is the Swagger UI at `/api/docs` (staging only); this file is the plan.

Roles: **SA** super admin, **T** teacher, **A** assistant, **S** student, **P** public.

## Auth and devices
| Method | Path | Who | Purpose |
|---|---|---|---|
| * | `/api/auth/*` | P | Better Auth (served by Next.js) |
| GET | `/me` | any | User, membership, tenant branding, permissions |
| GET | `/me/devices` | S | Own devices |
| POST | `/device-requests` | P (password re-check) | Request device change |
| POST | `/signout-requests` | P (password re-check) | Request sign-out of other device |
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
| PATCH | `/students/:membershipId` | T, A | Suspend / reactivate, `max_devices` |
| POST | `/students/:membershipId/enrollments` | T, A | Add course |
| DELETE | `/enrollments/:id` | T, SA | Terminate |
| POST | `/devices/:id/revoke` | T, A | Revoke device |
| POST | `/users/:id/force-signout` | T, A | End all sessions |
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
| GET/POST | `/support-requests` | S (own), T, A | |
| POST | `/support-requests/:id/approve` · `/reject` | T, A | Device and sign-out requests |
| GET | `/audit-logs` | T, SA | Filter by actor, action, date |
| GET | `/analytics/overview` | T, A | Dashboard numbers |
