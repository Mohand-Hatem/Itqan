# Tenant membership design: several teachers and assistants per tenant

Status: **superseded** (2026-11-17). Historical audit notes only. The approved design is in [ADR-012](../../adr/012-no-two-factor.md), [ADR-013](../../adr/013-account-provisioning.md), [ADR-014](../../adr/014-guardian-consent.md), the SRS and Phase 10R of [tasks/todo.md](../../../tasks/todo.md); where this file disagrees with them, they win.

## Summary

The database already supports this. `memberships` has one row per user per tenant with a tenant-scoped role, and nothing limits a tenant to one teacher. What is missing is the super admin API to manage a tenant's staff, plus a few responses that show only the first teacher. **No schema change and no data migration are needed.**

## Current model

```text
users (global)                       tenants
  id, email (unique)                   id, slug (unique), paused_roles
  is_super_admin   ◄── platform role
  max_devices, status, two_factor_enabled
      │ 1                                 │ 1
      │                                   │
      └──────────── * memberships * ──────┘
                     tenant_id, user_id   UNIQUE (tenant_id, user_id)
                     role: teacher | assistant | student
                     status: active | suspended
```

| Cardinality | Supported now? |
|---|---|
| One tenant, many teachers | Yes in the schema. Only the first teacher is created and shown by the admin API. |
| One tenant, many assistants | Yes. Teachers add them with `POST /assistants`. |
| One teacher, many tenants | Yes (ADR-007, FR-A04). The same login works on each tenant host. |
| One assistant, many tenants | Yes. |
| One person with two roles in one tenant | No. The unique key allows one role per tenant. That is a sensible rule: a teacher who wants to test the student view uses a second email. |

The questions "is there a separate membership table?" and "do we need one?" have the same answer: `memberships` is that table, and it already does the job.

## Options I considered

| Option | What it means | Verdict |
|---|---|---|
| A. Keep `memberships`, add admin routes | No schema change. New routes under `/api/admin/tenants/{id}/staff`. | **Recommended.** Smallest change, reuses the role checks, isolation tests and audit code that already exist. |
| B. A separate `tenant_staff` table | Staff in one table, students in `memberships` | Rejected. It would split role checks across two tables and duplicate the guard and the isolation sweep. |
| C. Many roles per membership (`roles[]`) | One person could be teacher and student in a tenant | Rejected. It makes every `@Roles` check and the student device rules ambiguous, and no one asked for it. |

## Proposed API (super admin only, admin host)

All routes use `@SuperAdminOnly()`, run on `admin.<root>`, write an audit entry and use one transaction per write. The admin context is not tenant-scoped (`tenant-extension.ts` returns queries unchanged for `kind: "admin"`), so **every query in these routes names `tenantId` explicitly**, and the tests check it.

| Method and path | Purpose | Rules |
|---|---|---|
| `GET /api/admin/tenants/{id}/staff` | List a tenant's teachers and assistants | Returns membership id, user id, name, email, role, status, `mfaEnrolled`, created date. Students are not listed here. |
| `POST /api/admin/tenants/{id}/staff` | Add a teacher or assistant | Body: `email`, `name`, `role` (`teacher` or `assistant`), `temporaryPassword` (only used when the email has no account yet). An existing user is linked. If the user already has any membership in this tenant: 409 `MEMBERSHIP_ALREADY_EXISTS` (no silent role change from student to staff). |
| `PATCH /api/admin/tenants/{id}/staff/{membershipId}` | Change role (teacher ⇄ assistant) or status (active ⇄ suspended) | Refuses student memberships (404). Refuses to demote or suspend the last active teacher: 409 `LAST_TEACHER`. |
| `DELETE /api/admin/tenants/{id}/staff/{membershipId}` | Remove a teacher or assistant from the tenant | Deletes the membership. Same last-teacher rule. Ends the user's staff sessions only when this was their last staff role anywhere, the same as `assistants.service.ts` delete today. |

Changes to existing routes:

| Route | Change |
|---|---|
| `POST /api/admin/tenants` | Unchanged input: `teacherEmail` becomes the first teacher. A tenant never starts with zero teachers. |
| `GET /api/admin/tenants`, `GET /api/admin/tenants/{id}`, `PATCH /api/admin/tenants/{id}` | Replace `teacher: {…} \| null` with `teachers: [{…}]` and add `assistantCount`. No frontend uses these yet (Track A), so this is the cheapest moment to change the shape. |
| `/api/assistants` (teacher, tenant host) | Unchanged. Teachers keep managing assistants. They do not manage other teachers. |

The new code reuses the create-or-link logic from `assistants.service.ts` (password hash through `auth.$context`, link an existing user, audit) and the session-ending rule from its delete. I'd move that logic into one shared function used by both services, so the two paths cannot drift apart.

## Why removal and role changes are safe

- `AccessGuard` reads the membership from the database on every request, so a role change or removal takes effect on the user's next request. No session needs to be rewritten.
- Staff sessions carry no tenant, so removing someone from tenant A leaves their access to tenant B untouched. Their sessions end only when they have no staff role left (the existing rule from audit run 1).
- Staff memberships own no tenant data. Enrollments, progress, attempts and comments hang off student memberships. Columns such as `granted_by` and `created_by` point at `users`, not memberships, so deleting a staff membership keeps the history.
- Nothing in the code looks up "the" teacher of a tenant except the admin tenant responses, which this change fixes. Settings, audit log, analytics and notifications already work with any number of teachers.

## Privilege escalation guards

- No route writes `users.is_super_admin`. Better Auth marks it `input: false`, so `update-user` cannot set it.
- Super admins are created by a seed or script with direct database access, never over HTTP. Local development gets one through the dev seed in the [implementation plan](implementation-plan.md).
- Teachers and assistants cannot reach `/api/admin/*`: `@SuperAdminOnly` refuses them, and the admin host refuses anyone who is not a super admin.
- A teacher cannot promote themself or anyone else to teacher; only the super admin routes change roles.

## Migration

None. Every existing tenant already has its teacher as a `teacher` membership.

Before release, one read-only check on each database (Docker, then Neon `dev`, then `main`) confirms that every live tenant has at least one active teacher:

```sql
SELECT t.slug
FROM tenants t
WHERE t.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.tenant_id = t.id AND m.role = 'teacher' AND m.status = 'active');
```

An empty result means the last-teacher rule holds from day one.

## Tests to add

- Super admin lists, adds, changes and removes staff in tenant A; tenant B's staff never appear and are never changed (isolation).
- Teacher, assistant and student get 403 on every new route, on the tenant host and on the admin host.
- Last active teacher: demote, suspend and delete each return 409; with two teachers, each works.
- Adding an email that is already a student in the tenant returns 409.
- Removing a user who is staff on two tenants keeps their session working on the other tenant.
- Every write leaves exactly one audit entry.

No new tenant table means no new fixture for the isolation sweep.
