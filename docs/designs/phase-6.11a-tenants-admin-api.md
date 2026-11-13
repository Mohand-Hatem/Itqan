# Phase 6.11a Design: Super Admin Tenant API (FR-T02, FR-T05)

* **Status:** Approved RFC / Execution Specification
* **Target Step:** Phase 6, Step 6.11a (`tasks/todo.md` line 117)
* **Functional Requirements:** FR-T02, FR-T05 (`docs/02-srs.md`), `docs/04-database.md`, `docs/07-api.md` (`/admin/tenants`)
* **Architecture Boundary:** Track A (Business Logic & REST API; UI deferred to Phase U / Step 6.11b per ADR-010)
* **Author:** Ahmed-Abd-EL-Kareem
* **Date:** 2026-11-13

---

## 1. Overview & Objectives

Itqan operates as a multi-tenant platform where each educational academy resides under its own subdomain (`<slug>.<root>`). The Super Admin oversees the entire infrastructure from the dedicated management portal (`admin.<root>`) or with super admin credentials from any host.

Step 6.11a implements the Super Admin API for provisioning and monitoring tenants:
1. **Tenant Provisioning (`POST /api/admin/tenants`):**
   - Super admin supplies `name`, `slug`, `teacherEmail`, optional `teacherName`, and `temporaryPassword`.
   - Provisions `Tenant` row and initial primary teacher account/membership atomically.
   - Newly created tenant subdomain (`<slug>.localhost`) immediately resolves over HTTP without cache latency (Done condition).
2. **Tenant Directory & Usage Analytics (`GET /api/admin/tenants`):**
   - Lists tenants with cursor pagination.
   - Computes live usage metrics using batched SQL queries:
     - `studentCount`: count of memberships with `role: "student"` and `status: "active"`.
     - `courseCount`: count of courses with `status: "published"` and `deletedAt: null`.
     - `storageBytes`: defaults to `0` (until Phase 7 introduces `media_assets`).
3. **Tenant Details (`GET /api/admin/tenants/:id`):**
   - Single tenant detail inspector returning full tenant configuration, primary teacher details, and resource usage breakdown.

---

## 2. API Specifications & Data Contracts

### 2.1 Shared Schemas (`packages/shared/src/schemas/tenants-admin.ts`)

```typescript
import { z } from "zod";

export const RESERVED_TENANT_SLUGS = [
  "admin",
  "api",
  "app",
  "www",
  "localhost",
  "mail",
  "static",
  "support",
  "status",
  "health",
  "docs",
  "auth",
  "public",
] as const;

export const AdminTenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Slug must be at least 3 characters")
  .max(32, "Slug must be at most 32 characters")
  .regex(/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/, "Slug must start and end with alphanumeric characters and may contain hyphens")
  .refine((val) => !RESERVED_TENANT_SLUGS.includes(val as (typeof RESERVED_TENANT_SLUGS)[number]), {
    message: "This subdomain slug is reserved by the platform",
  });

export const AdminTenantCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: AdminTenantSlugSchema,
  teacherEmail: z.string().trim().toLowerCase().email(),
  teacherName: z.string().trim().min(2).max(100).optional(),
  temporaryPassword: z.string().min(8).max(100),
});
export type AdminTenantCreateDto = z.infer<typeof AdminTenantCreateSchema>;

export const AdminTenantUsageSchema = z.object({
  studentCount: z.number().int().nonnegative(),
  courseCount: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
});
export type AdminTenantUsage = z.infer<typeof AdminTenantUsageSchema>;

export const AdminTenantListItemSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["active", "suspended", "paused"]),
  teacher: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string().email(),
    })
    .nullable(),
  usage: AdminTenantUsageSchema,
  createdAt: z.string().datetime(),
  existingUserLinked: z.boolean().optional(),
});
export type AdminTenantListItem = z.infer<typeof AdminTenantListItemSchema>;

export const AdminTenantListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminTenantListQuery = z.infer<typeof AdminTenantListQuerySchema>;

export const AdminTenantListResponseSchema = z.object({
  items: z.array(AdminTenantListItemSchema),
  nextCursor: z.string().uuid().nullable(),
});
export type AdminTenantListResponse = z.infer<typeof AdminTenantListResponseSchema>;
```

### 2.2 Endpoints

#### 1. `POST /api/admin/tenants`
- **Access:** Super admin only (`@SuperAdminOnly()`).
- **Processing:**
  1. Validate payload (`AdminTenantCreateSchema`).
  2. Check if slug exists in DB: if yes, throw `409 Conflict` (`SLUG_ALREADY_EXISTS`).
  3. In transaction on raw `PrismaClient` (`systemPrisma`):
     - Create `Tenant(slug, name, status: "active")`.
     - Check if user with `teacherEmail` exists:
       - If yes: link existing user (`existingUserLinked: true`), do NOT alter password.
       - If no: create `User` and `Account` with Better Auth hashed `temporaryPassword` and verified email.
     - Create `Membership(tenantId: tenant.id, userId, role: "teacher", status: "active")`.
     - Write audit log `tenant.create` (`actorUserId: user.id`, `targetType: "tenant"`, `targetId: tenant.id`).
  4. Explicitly pre-populate or invalidate `TenantResolver` cache for `slug` to avoid negative caching stalls.
- **Response:** `201 Created` with `AdminTenantListItem`.

#### 2. `GET /api/admin/tenants`
- **Access:** Super admin only (`@SuperAdminOnly()`).
- **Processing:**
  1. Fetch tenants with cursor pagination (default 20, max 100), ordered by `createdAt: desc`, `where: { deletedAt: null }`.
  2. Extract `tenantIds`.
  3. Run 2 batched `groupBy` queries:
     - `db.membership.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, role: "student", status: "active" }, _count: { id: true } })`
     - `db.course.groupBy({ by: ["tenantId"], where: { tenantId: { in: tenantIds }, status: "published", deletedAt: null }, _count: { id: true } })`
  4. Fetch primary teacher for each tenant.
  5. Combine into `AdminTenantListItem[]`.
- **Response:** `200 OK` with `{ items, nextCursor }`.

#### 3. `GET /api/admin/tenants/:id`
- **Access:** Super admin only (`@SuperAdminOnly()`).
- **Processing:**
  - Find tenant by `id` (`where: { id, deletedAt: null }`). If not found, throw `404 TENANT_NOT_FOUND`.
  - Count active students and published courses.
  - Fetch teacher.
- **Response:** `200 OK` with `AdminTenantListItem`.

---

## 3. Security, Caching & Architectural Invariants

1. **Role Gating:**
   - Enforce `@SuperAdminOnly()` on `AdminTenantsController`.
   - Teachers, assistants, and students receive `403 ROLE_FORBIDDEN` or `403 NO_ACCESS`. Unauthenticated requests receive `401`.
2. **Database Scoping Exemption:**
   - Inject raw `PrismaClient` (or `systemPrisma`) in `AdminTenantsService` to prevent `TenantScopeError("TENANT_MISMATCH")` when creating records across tenant boundaries.
3. **Subdomain Resolution & Cache Defense:**
   - Extend `createTenantLookup` in `packages/database/src/tenant-lookup.ts` with `.invalidate(slug)` and `.set(slug, tenant)`.
   - Upon creating a new tenant, update the lookup cache immediately so the host `<slug>.localhost` resolves over HTTP on the very next millisecond.
4. **Performance:**
   - No N+1 queries in listing; constant 3 SQL queries for any page size using `groupBy`.

---

## 4. Test Strategy

Integration test suite in `apps/api/src/tenants-admin/admin-tenants.int.spec.ts`:
- **Creation & Instant Host Resolution (Done Condition):**
  - Super admin posts new tenant `new-academy` with teacher credentials -> 201 Created.
  - Subdomain resolution check: `http.send("new-academy.localhost", "GET", "/api/context-probe")` or `/api/health` immediately resolves with 200.
- **Directory & Usage Metrics:**
  - Create students and published courses on tenant.
  - Super admin lists tenants -> verifies `studentCount`, `courseCount`, and `storageBytes: 0`.
- **Detail View:**
  - Super admin retrieves tenant by ID -> returns full details.
- **Reusing Existing User:**
  - Super admin provisions new tenant with email of an existing student on another tenant -> student is linked as teacher on new tenant, old password still works on original tenant.
- **Validation & Role Barriers:**
  - Reserved slugs (`admin`, `api`, `app`, `support`) rejected with 400.
  - Invalid slug regex rejected with 400.
  - Duplicate slug rejected with 409.
  - Teacher, Assistant, and Student rejected with 403 on all `/admin/tenants` routes.
  - Unauthenticated rejected with 401.
