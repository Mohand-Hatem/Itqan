# Phase 6.1: Courses API (Multi-Tenant Course Lifecycle)

* **Author:** Ahmed-Abd-EL-Kareem
* **Date:** 2026-11-12
* **Target Step:** Phase 6, Step 6.1 (`tasks/todo.md`)
* **Status:** Multi-Lens Synthesized Concept Brief (RFC)

---

## Overview

Phase 6.1 builds the foundational multi-tenant **Courses API** for Itqan LMS. As the root administrative container for educational curricula, courses organize content trees (Phase 7), media assets (Phase 7), question banks and quizzes (Phase 8), and student enrollments (Phase 6.7).

Courses are strictly tenant-owned and indexed using sequential UUIDv7 primary keys. In Step 6.1, staff (teachers and assistants) can create, inspect, edit, publish, and archive courses. Course deletion is implemented as a soft-delete (`deleted_at`), restricted strictly to teachers and super admins. Students receive 403 `ROLE_FORBIDDEN` until enrollment-based scoping is introduced in Step 6.7.

---

## Analysis

### 1. Codebase Mechanics & Tenant Isolation
- **Tenant Extension Enforcement:** In `packages/database/src/tenant-extension.ts`, `TENANT_MODELS` is a `ReadonlySet<string>`. A static test in `packages/database/src/tenant-extension.spec.ts` verifies that every model with a `tenant_id` column in `schema.prisma` is registered in `TENANT_MODELS`. Adding `model Course` requires adding `"Course"` to `TENANT_MODELS` and updating `TENANT_FIXTURES` in `packages/database/src/testing/fixtures.ts`.
- **Soft-Delete Query Discipline:** The Prisma tenant extension enforces `tenantId` filtering automatically, but does NOT filter `deletedAt`. All queries in `CoursesService` must explicitly include `where: { deletedAt: null }` to ensure soft-deleted courses are completely hidden from regular list and retrieve operations.
- **Unconstrained Thumbnail Asset ID:** In Step 6.1, `media_assets` does not yet exist (Phase 7). `thumbnailAssetId` must be stored as an unconstrained UUID column (`String? @map("thumbnail_asset_id") @db.Uuid`) without a relational foreign key.

### 2. State Machine & Lifecycle Transitions
```
[Draft] <---------> [Published] ---------> [Archived]
   |                     |                     |
   +---------------------+---------------------+
                         |
                         v (Soft Delete - Teacher Only)
                  [DeletedAt != null]
```
- `draft`: Default status upon creation. Editable by teachers and assistants.
- `published`: Publicly active course on the tenant.
- `archived`: Read-only historical status. Prevents new student registrations while preserving student historical records.
- `deletedAt`: Timestamp of soft deletion. Soft-deleted courses return 404 on `GET /courses/:id` to avoid existence leaking.

### 3. API Surface & Authorization Ergonomics
- **Role Guards:** The controller uses class-level `@Roles("teacher", "assistant")`. The `DELETE /courses/:id` endpoint overrides this with `@Roles("teacher")`, which automatically rejects assistants with 403 `ROLE_FORBIDDEN`.
- **Student Scoping:** In `docs/07-api.md`, student access to `/courses` is denoted as `(S: own)`. Because the `enrollments` table is not introduced until Step 6.7, student access in Step 6.1 is blocked at the gateway level with 403 `ROLE_FORBIDDEN`.
- **Audit Logging:** Mutating operations (`course.create`, `course.update`, `course.delete`) record an audit entry via `AuditService` containing actor, target, IP, user-agent, and relevant metadata diffs.

### 4. Database Indexing & Cursor Monotonicity
- Query profile:
  ```sql
  SELECT * FROM courses
  WHERE tenant_id = $1 AND deleted_at IS NULL AND status = $2 AND id < $3
  ORDER BY id DESC LIMIT $4;
  ```
- Because UUIDv7 contains millisecond-precision timestamps in the high bits, sorting by `id DESC` guarantees strict chronological ordering. Even if the boundary record represented by `cursor` is soft-deleted between paginated requests, the inequality `id < cursor` maintains monotonic pagination without dropped or duplicated rows.
- Compound indexes in Prisma schema:
  - `@@index([tenantId, status, id(sort: Desc)])`
  - `@@index([tenantId, deletedAt])`

---

## Goals vs. Non-Goals

### In-Scope Goals (Step 6.1):
* Database migration adding `CourseStatus` enum and `courses` table with UUIDv7 and soft delete.
* Registering `Course` in `TENANT_MODELS` and `TENANT_FIXTURES` with 100% passing isolation tests.
* Shared Zod contracts in `@itqan/shared` for create, patch, query, and response shapes.
* NestJS `CoursesModule`, `CoursesController`, and `CoursesService`.
* Cursor-based pagination (`limit`, `cursor`, `nextCursor`) and `status` query filtering.
* Role-based access control (teachers & assistants can create/edit; teachers only can delete; students receive 403).
* Audit logging for all mutating operations.
* Full integration test suite `courses.int.spec.ts` covering CRUD, edge cases, role rejection, pagination, and soft deletion.

### Out-of-Scope Non-Goals:
* Course restoration endpoint (no restore endpoint exists in project docs for courses).
* Student enrollment consumption (deferred to Step 6.7).
* Course content trees, chapters, lectures, and file streaming (deferred to Phase 7).
* Frontend management UI (deferred to Phase U / Step 6.2 under ADR-010).

---

## Alternatives Weighed

1. **Dedicated RPC Endpoints vs Unified PATCH for Status:**
   - *Alternative:* Create `POST /courses/:id/publish` and `POST /courses/:id/archive`.
   - *Decision:* Unified `PATCH /courses/:id` with `{ status: "published" | "archived" | "draft" }`. Step 6.1 does not require prerequisites before publishing (such as verifying content items), keeping the API surface minimal and RESTful.
2. **Course Restoration Endpoint (`POST /courses/:id/restore`):**
   - *Alternative:* Provide an un-delete endpoint.
   - *Decision: Rejected by author based on documentation analysis.* Documentation specifies restore only for content items (`/content-items/:id/restore` in Step 7.4). Course deletion is permanent from a business logic perspective.
3. **Student Access Behavior in Step 6.1:**
   - *Alternative:* Allow students to list all published courses in 6.1.
   - *Decision:* Block students with 403 `ROLE_FORBIDDEN`. `docs/07-api.md` defines student course access as `(S: own)`. Exposing un-enrolled courses violates the student boundary.

---

## Key Decisions & Staging for Next Steps

1. **Course Model:** Defined in `schema.prisma` with `id` (UUIDv7), `tenantId`, `title`, `description`, `thumbnailAssetId`, `status`, `createdAt`, `updatedAt`, `deletedAt`.
2. **Audit Logging Integration:** Mutating actions are executed in database transactions alongside `AuditService.record()` calls.
3. **Soft-Delete Concealment:** Enforced explicitly in service queries (`deletedAt: null`). Any query targeting a soft-deleted course returns 404 `COURSE_NOT_FOUND`.
4. **Step 6.1 Handoff to Step Gate:** Present the standard step brief per `CLAUDE.md § Workflow rules` to obtain owner approval before implementation begins.

---

## Acceptance Gates (Unlazy Ledger)

```markdown
# Gates: Phase 6.1 Courses API

OWNS: packages/database/prisma/schema.prisma packages/database/src/** packages/shared/src/** apps/api/src/courses/** apps/api/src/app.module.ts tasks/todo.md

Scope: Implement Courses API with soft delete, role controls, tenant isolation, and audit logging.

- [ ] G1: Database migration applies cleanly to Docker PostgreSQL and Prisma Client is generated
  CHECK: npm run db:generate
  EXPECT: Generated Prisma Client
  EVIDENCE: pending

- [ ] G2: Shared Zod validation schemas compile and export
  CHECK: npm run build -w @itqan/shared
  EXPECT: tsc -p tsconfig.json
  EVIDENCE: pending

- [ ] G3: TypeScript typecheck passes across all workspaces
  CHECK: npm run typecheck
  EXPECT: @itqan/web@0.1.0 typecheck
  EVIDENCE: pending

- [ ] G4: Courses integration tests pass 100% (CRUD, assistant delete forbidden, student 403, cursor pagination, status filter, soft-delete filtering, and audit logs)
  CHECK: npm test -w @itqan/api -- courses.int.spec.ts
  EXPECT: passed
  EVIDENCE: pending

- [ ] G5: Tenant isolation test suite passes with Course model included
  CHECK: npm test -w @itqan/database -- tenant-extension.int.spec.ts
  EXPECT: passed
  EVIDENCE: pending
```
