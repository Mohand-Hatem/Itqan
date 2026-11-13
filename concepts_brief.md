# Super Admin Lifecycle & Access Control API (Step 6.12a — FR-T03, FR-T04)

* **Author:** Ahmed-Abd-EL-Kareem
* **Date:** 2026-11-13
* **Target Step:** Phase 6, Step 6.12a (`tasks/todo.md` line 119)
* **Functional Requirements:** FR-T03, FR-T04 (`docs/02-srs.md`), `docs/04-database.md`, `docs/05-auth-devices.md`, `docs/06-flows.md`, `docs/07-api.md`
* **Architecture Boundary:** Track A (Backend REST API & Lifecycle Invariants; UI deferred to Phase U / Step 6.12b per ADR-010)

---

## Overview

Platform super administrators manage the operational lifecycle of academies and platform-wide user security. Step 6.12a implements the backend administrative controls to modify tenant operational states, selectively freeze permissions, revoke user access globally, and soft-delete organizations:

1. **Role Pausing & Tenant Updates (`PATCH /api/admin/tenants/:id` — FR-T03):**
   - Super admins can update basic tenant metadata (`name`, `slug`) or toggle role-level freezes via `pausedRoles` (`teacher`, `assistant`, `student`, or any combination).
   - When a role is added to `pausedRoles`, the API transactionally updates the tenant and terminates all active sessions belonging to members holding that newly paused role in that tenant.
   - Non-paused roles (e.g., the teacher when students are paused) remain entirely functional with unaffected sessions.
   - If the slug changes, cache entries are invalidated and pre-populated to ensure seamless host routing.

2. **Tenant Soft Deletion (`DELETE /api/admin/tenants/:id` — FR-T04):**
   - Marks the tenant as deleted (`status = "deleted"`, `deletedAt = now()`), evicts its slug from the tenant resolution cache, and immediately deletes all sessions associated with that tenant.
   - Any subsequent HTTP request targeting `<slug>.<root>` receives `404 TENANT_NOT_FOUND`.
   - Data and files remain preserved in the database for the 30-day retention grace period before permanent purging.

3. **Global User Suspension (`PATCH /api/admin/users/:id` — FR-T03):**
   - Allows super administrators to suspend or reactivate individual users (`status = "suspended" | "active"`).
   - Suspending a user immediately deletes all their active sessions across all tenants and blocks subsequent authentication or API access with `403 USER_SUSPENDED`.
   - Enforces a self-suspension guard preventing a super admin from locking themselves out (`400 CANNOT_SUSPEND_SELF`).

4. **Done Condition:**
   - Pausing students ends their sessions while the teacher still works; soft-deleting a tenant terminates all tenant sessions and disables subdomain resolution (returns `404 TENANT_NOT_FOUND`).

---

## Analysis

Synthesized across the seven specialized Goldfish evaluation lenses (`egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`, `egm-inventive-catalyst`):

### 1. Selective Session Eviction vs. Preserved Sessions
* **Contradiction:** We need to instantly evict only users belonging to a newly paused role (e.g., students), but `Session` does not store `role` (role belongs to `Membership`).
* **Resolution:** Execute a two-stage transactional query:
  1. Calculate `newlyPaused = dto.pausedRoles.filter(r => !currentTenant.pausedRoles.includes(r))`.
  2. If `newlyPaused` is non-empty, query `Membership.findMany` for `userId` where `tenantId = id` and `role in newlyPaused`.
  3. Bulk delete matching rows: `tx.session.deleteMany({ where: { tenantId: id, userId: { in: userIds } } })`.
  4. Unaffected roles (such as the teacher) have zero session deletions and continue uninterrupted.

### 2. Tenant Soft Deletion & Subdomain Cache Eviction
* **Contradiction:** In-memory tenant caching (60s TTL) shields the database from DoS, but soft deletion must immediately disable the tenant on its subdomain.
* **Resolution:** Transactionally mark `status = "deleted"`, `deletedAt = new Date()`, and delete all tenant sessions (`tx.session.deleteMany({ where: { tenantId: id } })`). Immediately post-commit, invoke `tenantResolver.invalidate(tenant.slug)`. The next incoming request falls through to the database query, observes `deletedAt IS NOT NULL`, caches `null`, and returns `404 TENANT_NOT_FOUND`.

### 3. Global User Suspension vs. Tenant Membership Suspension
* **Taxonomy Distinction:**
  - *Tenant Membership Suspension (`PATCH /students/:membershipId` — Step 5.9):* Evicts sessions only for that specific `tenantId`. The user can still access other tenants where they are enrolled.
  - *Global User Suspension (`PATCH /admin/users/:id` — Step 6.12a):* Toggles `User.status = "suspended"`. Evicts all sessions across all tenants (`tx.session.deleteMany({ where: { userId: targetUserId } })`). All subsequent logins or authenticated API requests receive `403 USER_SUSPENDED`.
* **Self-Suspension Guard:** The service explicitly verifies `if (actorUserId === targetUserId && dto.status === "suspended") throw new BadRequestException({ reason: "CANNOT_SUSPEND_SELF" })`.

### 4. Slug Uniqueness on Soft-Deleted Tenants
* In PostgreSQL, `slug` is marked `@unique` across all rows.
* During the 30-day retention grace period, soft-deleted slugs remain reserved to allow potential administrative restoration. If a new tenant attempts to claim a soft-deleted slug, `409 SLUG_ALREADY_EXISTS` is returned.

---

## Goals vs. Non-Goals

### In-Scope Goals:
* `PATCH /api/admin/tenants/:id`: Update `name`, `slug`, and `pausedRoles` with session eviction for newly paused roles.
* `DELETE /api/admin/tenants/:id`: Soft delete tenant (`status: "deleted"`, `deletedAt: now()`), evict cache, terminate all tenant sessions, return `200 OK` with `{ id, status: "deleted", deletedAt, sessionsEvicted }`.
* `PATCH /api/admin/users/:id`: Suspend or reactivate user (`status: "suspended" | "active"`) with global session termination on suspension and self-suspension guard.
* Strict `@SuperAdminOnly()` role guarding on all administrative endpoints.
* Immutable audit logging for `tenant.update`, `tenant.delete`, `user.suspend`, and `user.reactivate`.
* Comprehensive integration test suite verifying done conditions, partial role pauses, user suspensions, and 404 host resolution.

### Out-of-Scope Non-Goals:
* Permanent purging of soft-deleted tenants (handled by the 30-day scheduled background worker in Phase 10).
* Super admin export ZIP of tenant data (scheduled as a separate operational task per `docs/06-flows.md`).
* Admin frontend UI pages (deferred to Phase U, Step 6.12b per ADR-010).

---

## Alternatives Weighed

1. **Dedicated sub-resource endpoints (`POST /admin/tenants/:id/pause-roles`, `POST /admin/tenants/:id/unpause-roles`):**
   - *Rejected:* `docs/07-api.md` specifies `PATCH /admin/tenants/:id` for name, slug, and `paused_roles`. Unifying these fields into a single `PATCH` endpoint matches REST conventions and avoids route sprawl.
2. **Hard deletion (`DELETE FROM tenants`):**
   - *Rejected by SRS (FR-T04):* SRS requires soft-deletion with a 30-day retention window before permanent purge, enabling accidental deletion recovery and regulatory compliance.
3. **Renaming slugs on soft delete (`slug = slug + "-deleted-" + timestamp`):**
   - *Rejected:* Preserving the original slug during the 30-day grace period maintains data integrity for audit logs, administrative export, and prevents URL hijacking of recently active schools.
4. **Empty `204 No Content` on Soft Deletion:**
   - *Rejected:* Returning `200 OK` with `{ id, status: "deleted", deletedAt, sessionsEvicted }` provides operational visibility and verification data for super administrative tooling.

---

## Key Decisions & Staging for Next Steps

* **Contracts:**
  - `AdminTenantUpdateSchema`: `{ name?: string, slug?: string, pausedRoles?: Role[] }` in `packages/shared/src/schemas/tenants-admin.ts`.
  - `AdminUserUpdateSchema`: `{ status: "active" | "suspended" }` in `packages/shared/src/schemas/tenants-admin.ts`.
* **Controllers:**
  - `AdminTenantsController`: Handles `PATCH :id` and `DELETE :id`.
  - `AdminUsersController`: Dedicated controller at `@Controller("admin/users")` handling `PATCH :id`.
* **Service:**
  - `AdminTenantsService`: Contains `update(actorId, tenantId, dto)`, `softDelete(actorId, tenantId)`, and `updateUserStatus(actorId, targetUserId, dto)`.
* **Integration Tests:**
  - `apps/api/src/tenants-admin/admin-tenants-lifecycle.int.spec.ts`: Tests role pausing (teacher unaffected, student evicted & blocked), soft-delete (sessions evicted, `<slug>.localhost` returns 404), user suspension (global eviction, 403 response), and self-suspension guard.
