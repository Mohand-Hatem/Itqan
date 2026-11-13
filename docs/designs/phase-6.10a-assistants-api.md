# Phase 6.10a Design: Assistant Management API (FR-D06)

* **Status:** Approved RFC / Execution Specification
* **Target Step:** Phase 6, Step 6.10a (`tasks/todo.md` line 115)
* **Functional Requirements:** FR-D06, FR-A03, FR-T03 (`docs/02-srs.md`), `docs/07-api.md` (`/assistants`)
* **Architecture Boundary:** Track A (Business Logic & REST API; UI deferred to Phase U / Step 6.10b per ADR-010)
* **Author:** Ahmed-Abd-EL-Kareem
* **Date:** 2026-11-13

---

## 1. Overview & Objectives

In the Itqan tenant hierarchy, each educational tenant is owned by a single Teacher who may delegate operational tasks (managing students, handling device resets, monitoring support requests, and viewing course access) to one or more subordinate Assistants.

Step 6.10a implements the dedicated backend lifecycle API for assistants (`/api/assistants`). This API allows the Teacher (and Super Admin) to:
1. Directly provision assistant accounts with credentials (`POST /api/assistants`).
2. List active assistants on the tenant (`GET /api/assistants`).
3. Permanently remove an assistant with immediate session termination (`DELETE /api/assistants/:id`).

To maintain strict organizational hierarchy:
- Assistants cannot manage peers.
- Students cannot view or touch staff.
- Assistant status is binary (either active member or removed).

---

## 2. API Specifications & Data Contracts

### 2.1 Shared Schemas (`packages/shared/src/schemas/assistants.ts`)

```typescript
import { z } from "zod";

export const AssistantCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  temporaryPassword: z.string().min(8).max(100),
});
export type AssistantCreateDto = z.infer<typeof AssistantCreateSchema>;

export const AssistantListItemSchema = z.object({
  id: z.string().uuid(), // membershipId
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.literal("assistant"),
  createdAt: z.string().datetime(),
});
export type AssistantListItem = z.infer<typeof AssistantListItemSchema>;

export const AssistantDeleteResponseSchema = z.object({
  id: z.string().uuid(),
  deleted: z.literal(true),
});
export type AssistantDeleteResponse = z.infer<typeof AssistantDeleteResponseSchema>;
```

### 2.2 Endpoints

#### 1. `POST /api/assistants`
- **Access:** Teacher, Super Admin (`@Roles("teacher")`). Assistants & Students receive `403 ROLE_FORBIDDEN`.
- **Request Body:** `AssistantCreateDto` (`name`, `email`, `temporaryPassword`).
- **Processing:**
  1. Check if user with normalized email exists in DB.
  2. If user exists:
     - Check if user has membership on this tenant -> if yes, throw `409 MEMBERSHIP_ALREADY_EXISTS`.
     - If user exists globally on another tenant -> throw `409 USER_ALREADY_REGISTERED` (prevents password takeover).
  3. If user does not exist:
     - Create user via Better Auth / `auth.api.signUpEmail` or direct user creation with password hashing and `emailVerified: true`.
     - Create `Membership` with `tenantId`, `userId`, `role: "assistant"`, `status: "active"`.
     - Write audit log `assistant.created`.
- **Response:** `201 Created` with `AssistantListItem`.

#### 2. `GET /api/assistants`
- **Access:** Teacher, Super Admin (`@Roles("teacher")`). Assistants & Students receive `403 ROLE_FORBIDDEN`.
- **Processing:**
  - Query all memberships on `tenantId` with `role: "assistant"`.
  - Include relation `user` (`id`, `name`, `email`).
- **Response:** `200 OK` with `AssistantListItem[]`.

#### 3. `DELETE /api/assistants/:id`
- **Access:** Teacher, Super Admin (`@Roles("teacher")`). Assistants & Students receive `403 ROLE_FORBIDDEN`.
- **Param:** `:id` is the assistant's `membershipId`.
- **Processing:**
  1. Find membership with `where: { id, tenantId }`.
  2. If not found or `role !== "assistant"`, throw `404 ASSISTANT_NOT_FOUND`.
  3. In a transaction:
     - Delete all sessions on this tenant: `tx.session.deleteMany({ where: { userId: membership.userId, tenantId } })`.
     - Delete membership: `tx.membership.delete({ where: { id } })`.
     - Write audit log `assistant.deleted`.
- **Response:** `200 OK` with `{ id, deleted: true }`.

---

## 3. Security & Isolation Invariants

1. **Role Gating:**
   - `@UseGuards(SessionGuard, AccessGuard)` with `@Roles("teacher")`.
   - Assistants cannot call any `/api/assistants` routes (`403 ROLE_FORBIDDEN`).
   - Students cannot call any `/api/assistants` routes (`403 ROLE_FORBIDDEN`).
2. **Tenant Isolation:**
   - Teacher on Tenant A cannot view or delete assistants on Tenant B (`404 ASSISTANT_NOT_FOUND`).
3. **Target Protection:**
   - Teacher cannot delete self or student memberships via `DELETE /api/assistants/:id` (`404 ASSISTANT_NOT_FOUND`).
4. **Instant Invalidation:**
   - Deleted assistant's sessions on the tenant are purged immediately, cutting off access on their next request (`401 Unauthorized`).
5. **MFA Enrolment:**
   - When the assistant signs in through the staff portal with their temporary credentials, `twoFactorEnabled: false` mandates TOTP MFA setup per FR-A03 before any `/manage` dashboard access.

---

## 4. Test Strategy

Integration test suite in `apps/api/src/assistants/assistants.int.spec.ts`:
- **CRUD Lifecycle:**
  - Teacher creates assistant -> 201 Created with metadata.
  - Assistant signs in with temporary password.
  - Teacher lists assistants -> returns created assistant.
  - Teacher deletes assistant -> 200 OK, membership is removed.
  - Deleted assistant makes request with previous session cookie -> 401 Unauthorized.
- **Role Barriers:**
  - Assistant calling `POST /api/assistants` -> 403 ROLE_FORBIDDEN.
  - Assistant calling `GET /api/assistants` -> 403 ROLE_FORBIDDEN.
  - Assistant calling `DELETE /api/assistants/:id` -> 403 ROLE_FORBIDDEN.
  - Student calling any assistant endpoint -> 403 ROLE_FORBIDDEN.
  - Unauthenticated call -> 401 Unauthorized.
- **Edge Cases & Isolation:**
  - Reject duplicate membership with 409.
  - Reject globally registered user with 409.
  - Teacher A cannot delete Assistant on Tenant B (404).
  - Teacher cannot delete teacher or student membership via `/assistants/:id` (404).
