# Authorization matrix

Status: **superseded** (2026-11-17). Historical audit notes only. The approved design is in [ADR-012](../../adr/012-no-two-factor.md), [ADR-013](../../adr/013-account-provisioning.md), [ADR-014](../../adr/014-guardian-consent.md), the SRS and Phase 10R of [tasks/todo.md](../../../tasks/todo.md); where this file disagrees with them, they win.

Legend: ✅ allowed · ❌ refused · "own" = only the caller's own records · SA = super admin.

## How permissions are checked

| Layer | Kind | Where |
|---|---|---|
| Global platform | `users.is_super_admin`, checked by `@SuperAdminOnly()` and by the admin host | `access.guard.ts` |
| Tenant role | `memberships.role` for the current host, checked by `@Roles(...)` | `access.guard.ts` |
| Resource rules | Checks inside services: target must be a student, item must be published, author owns the comment, teacher-only `max_devices`, and so on | each `*.service.ts` |
| Student scope | Student routes filter by the caller's own membership; content goes through the publish and enrollment gate | `progress`, `attempts`, `content-access` services |

A super admin passes every `@Roles` check on any tenant host, even with no membership there. Some services still need a membership and refuse a super admin who has none: progress and attempts (student membership), and comments (`comments.controller.ts`, 403 "No tenant membership found"). The SA column shows ✅ where the guard lets a super admin through; I did not test every service with a membership-less super admin.

## Current permissions (from the code)

| Action | SA | Teacher | Assistant | Student | Where |
|---|---|---|---|---|---|
| Manage tenants (create, edit, pause roles, delete) | ✅ | ❌ | ❌ | ❌ | `admin-tenants.controller.ts` `@SuperAdminOnly` |
| Assign tenant teachers | Only the first teacher, at tenant creation | ❌ | ❌ | ❌ | `admin-tenants.service.ts` create |
| Assign tenant assistants | ✅ (through the teacher routes on the tenant host) | ✅ | ❌ | ❌ | `assistants.controller.ts` `@Roles("teacher")` |
| List, view, suspend students; force sign-out | ✅ | ✅ | ✅ | ❌ | `students*.controller.ts` |
| Invite students (create, resend, revoke) | ✅ | ✅ | ✅ | ❌ | `invitations.controller.ts` |
| Enroll a student by hand | ✅ | ✅ | ✅ | ❌ | `enrollments.controller.ts:24` |
| End an enrollment | ✅ | ✅ | ❌ | ❌ | `enrollments.controller.ts:49` |
| Change a student's device limit | ✅ | ✅ | ❌ | ❌ | `students-access.service.ts:110` |
| Revoke a student's device | ✅ | ✅ | ✅ | ❌ | `students-access.controller.ts` |
| Decide device, sign-out and support requests | ✅ | ✅ | ✅ | create and list own | `support-requests.controller.ts` |
| Create or revoke access-code batches | ✅ | ✅ | ❌ | ❌ | `code-batches.controller.ts:28,72` |
| List batches and their codes | ✅ | ✅ | ✅ | ❌ | `code-batches.controller.ts:44,58` |
| Redeem an access code | n/a | n/a | n/a | ✅ any signed-in user | `code-redemption.controller.ts` (`@Public`, reads the session) |
| Create and edit courses | ✅ | ✅ | ✅ | ❌ | `courses.controller.ts` |
| Delete a course | ✅ | ✅ | ❌ | ❌ | `courses.controller.ts:76` |
| Manage content items and uploads (incl. delete and restore) | ✅ | ✅ | ✅ | ❌ | `content-items.controller.ts`, `uploads.controller.ts` |
| Read the course tree and content links | ✅ | ✅ full tree | ✅ full tree | published items of enrolled courses | `content-items.controller.ts` |
| Question banks: create, edit | ✅ | ✅ | ✅ | ❌ | `question-banks.controller.ts` |
| Delete a question bank | ✅ | ✅ | ❌ | ❌ | `question-banks.controller.ts:80` |
| Questions and quizzes (all, incl. delete, publish, release grades) | ✅ | ✅ | ✅ | ❌ | `questions`, `quizzes` controllers |
| Take a quiz (start, answer, submit) | ❌ | ❌ | ❌ | ✅ own | `attempts.controller.ts` |
| See an attempt review | needs a membership (not verified) | ✅ | ✅ | own, after release | `attempts.controller.ts:103` |
| Extend an attempt or move it to another device | ✅ | ✅ | ✅ | ❌ | `attempts.controller.ts:114,134` |
| View one student's progress | ❌ no route | ❌ | ❌ | own | `progress.controller.ts` (gap F9) |
| View tenant analytics | ✅ | ✅ | ✅ | ❌ | `analytics.controller.ts` |
| Post announcements | ✅ | ✅ | ✅ | ❌ | `announcements.controller.ts:31` |
| Read announcements | ✅ | ✅ | ✅ | tenant-wide and own courses | `announcements.service.ts` |
| Lesson Q&A | ❌ without a membership | ✅ reply, hide, delete | ✅ reply, hide, delete | post and edit own on reachable items | `comments.service.ts` |
| Tenant settings and branding | ✅ | ✅ | ❌ | ❌ (public settings for all) | `settings.controller.ts` |
| Audit log | ✅ | ✅ | ❌ | ❌ | `audit.controller.ts` |
| Suspend or reactivate a platform user | ✅ (not self) | ❌ | ❌ | ❌ | `admin-users.controller.ts` |
| Create a super admin | ❌ no route (database only) | ❌ | ❌ | ❌ | `isSuperAdmin` has `input: false` in Better Auth |

## Where the docs disagree (F4, needs a decision)

| Topic | SRS role table (§2) | SRS requirement | Code |
|---|---|---|---|
| Access codes | Assistant ✅ "codes" | FR-E02: "The teacher generates access codes" | Teacher only for create and revoke; assistant can list |
| Ending enrollments | Assistant ✅ "enrollments" | FR-E05: "The teacher or super admin can terminate" | Teacher only |
| Invitations | Assistant ✅ | FR-E01: "The teacher creates email invitations" | Assistant ✅ |

Recommendation: keep the code as it is and correct the SRS role table so it matches the FR lines. The role table should split "enrollments" into "grant" (assistant ✅) and "end" (assistant ❌), and "codes" into "view" (✅) and "generate or revoke" (❌).

## Proposed changes

Only the changes the owner asked for:

| Action | SA | Teacher | Assistant | Student | Change |
|---|---|---|---|---|---|
| Enroll a student by hand | ✅ | ✅ | ✅ | ❌ | None: already allowed and tested |
| Assign tenant teachers | ✅ add, change role, suspend, remove | ❌ | ❌ | ❌ | **New** super admin routes (see [tenant-membership-design.md](tenant-membership-design.md)) |
| Assign tenant assistants | ✅ (new admin routes, plus the existing tenant routes) | ✅ unchanged | ❌ | ❌ | **New** super admin routes |
| List a tenant's staff | ✅ | ✅ assistants only, unchanged | ❌ | ❌ | **New** super admin route |

Rules for the new routes:
- Super admin only (`@SuperAdminOnly`). Teachers cannot add, demote or remove other teachers.
- A tenant always keeps at least one active teacher. Removing, suspending or demoting the last one returns 409.
- No route sets `is_super_admin`. Super admins are created only by a seed or script that reads the database directly.

Depending on the 2FA decision ([authentication-simplification.md](authentication-simplification.md)), the "must enrol TOTP" rule may change for teachers and assistants. That is a policy change, not a permission change, so it is not in this table.

## Separate recommendations (not part of the requested changes)

Each needs its own yes before anyone builds it.

| # | Suggestion | Why | Size |
|---|---|---|---|
| S1 | Let assistants generate code batches | The SRS role table already says so. Teachers who sell codes through assistants would need it. Codes are money, so it is a business call. | `@Roles` change plus a test |
| S2 | Staff route to see one student's progress (`GET /students/{id}/progress`) | Staff cannot see who finished what (F9). | New route, service query, isolation test |
| S3 | Super admin can "act as staff" only through a real membership | Today a super admin passes every `@Roles` check on any tenant with no membership, so the audit log shows actions in a tenant by someone with no role there. Keeping it is fine for support work. | Decision only |
| S4 | Ask for the linked person's consent before adding an existing user as an assistant (F6) | Today a teacher can attach any registered email | Invitation-style accept step |
