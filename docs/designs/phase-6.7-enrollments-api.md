# Design Document: Phase 6, Step 6.7 — Enrollments API (Add and Terminate)

**Target Step:** Phase 6, Step 6.7 (`tasks/todo.md` line 110)  
**Functional Requirements:** `FR-E04`, `FR-E05` (`docs/02-srs.md`)  
**API Contracts:** `docs/07-api.md § People`  
**Architecture Boundary:** Track A (Business Logic & REST API; UI deferred to Phase U per ADR-010)

---

## 1. Overview & Requirements

Enrollment in a course represents a student's entitlement to access course content, lessons, and materials.
- **FR-E04**: Enrollment is lifetime until terminated.
- **FR-E05**: The teacher or super admin can terminate an enrollment. History and grades stay.
- **Done Condition**: A terminated student receives `403` on course content.

### Core Operations
1. **Manual Course Grant (`POST /api/students/:membershipId/enrollments`)**:
   - Allowed roles: **Teacher** (`T`) and **Assistant** (`A`).
   - Body: `{ courseId: UUID }`.
   - Tenant isolation: The target student membership and the course must both belong to the request tenant context (`tenantId`).
   - If the student already holds an `active` enrollment: returns `400 Bad Request (ALREADY_ENROLLED)`.
   - If the student previously held a `terminated` enrollment: reactivates to `status: "active"`, `source: "manual"`, `grantedBy: actorUserId`, `terminatedAt: null`, `terminatedBy: null`, `updatedAt: NOW()`.
   - If no previous enrollment exists: creates a new `Enrollment` with `status: "active"`, `source: "manual"`, `grantedBy: actorUserId`.
   - Records audit log: `action: "enrollment.grant"`.
2. **Enrollment Termination (`DELETE /api/enrollments/:id`)**:
   - Allowed roles: strictly **Teacher** (`T`) and **Super Admin** (`SA`).
   - Assistants calling this endpoint receive `403 Forbidden (ROLE_FORBIDDEN)`.
   - Students calling this endpoint receive `403 Forbidden (ROLE_FORBIDDEN)`.
   - Soft-termination only: updates `status = "terminated"`, `terminatedAt = NOW()`, `terminatedBy = actorUserId`. History and grades in Postgres are preserved.
   - If already terminated: returns `400 Bad Request (ENROLLMENT_ALREADY_TERMINATED)`.
   - Records audit log: `action: "enrollment.terminate"`.
3. **Course Content Access Gate (`GET /api/courses/:id/access`)**:
   - Caller: **Student** (`S`).
   - Checks caller's student membership on the tenant:
     - If non-enrolled: returns `403 Forbidden (ENROLLMENT_REQUIRED)`.
     - If enrollment has `status === "terminated"`: returns `403 Forbidden (ENROLLMENT_TERMINATED)`.
     - If enrollment has `status === "active"`: returns `200 OK ({ access: true, courseId, status: "active" })`.

---

## 2. API Surface Specification

### 2.1 `POST /api/students/:membershipId/enrollments`
- **Access:** `@Roles("teacher", "assistant")`
- **Request Body (Zod: `EnrollmentCreateSchema`):**
  ```json
  {
    "courseId": "01944e82-7c3a-7a8b-9671-000000000001"
  }
  ```
- **Responses:**
  - `201 Created`:
    ```json
    {
      "id": "01944e90-0000-7000-8000-000000000001",
      "membershipId": "...",
      "courseId": "...",
      "status": "active",
      "source": "manual",
      "grantedBy": "..."
    }
    ```
  - `400 Bad Request` (`ALREADY_ENROLLED`): Student is already actively enrolled.
  - `404 Not Found` (`MEMBERSHIP_NOT_FOUND` / `COURSE_NOT_FOUND`): Target not found in tenant.

### 2.2 `DELETE /api/enrollments/:id`
- **Access:** `@Roles("teacher")` or Super Admin
- **Responses:**
  - `200 OK`:
    ```json
    {
      "id": "01944e90-0000-7000-8000-000000000001",
      "status": "terminated",
      "terminatedAt": "2026-11-12T18:30:00.000Z",
      "terminatedBy": "..."
    }
    ```
  - `400 Bad Request` (`ENROLLMENT_ALREADY_TERMINATED`): Already terminated.
  - `403 Forbidden` (`ROLE_FORBIDDEN`): Assistants or unauthorized callers.
  - `404 Not Found` (`ENROLLMENT_NOT_FOUND`): Nonexistent or other tenant.

### 2.3 `GET /api/courses/:id/access`
- **Access:** `@Roles("student")`
- **Responses:**
  - `200 OK`: `{ "access": true, "courseId": "...", "status": "active" }`
  - `403 Forbidden` (`ENROLLMENT_TERMINATED`): The student's enrollment was terminated.
  - `403 Forbidden` (`ENROLLMENT_REQUIRED`): The student is not enrolled in this course.
  - `404 Not Found` (`COURSE_NOT_FOUND`): Course does not exist or is soft-deleted.

---

## 3. Concrete Acceptance Gates (G1 to G5)

- [ ] G1: Zod schema `EnrollmentCreateSchema` defined in `@itqan/shared` and compiles cleanly
- [ ] G2: Manual enrollment grant and reactivation integration tests pass 100%
- [ ] G3: Enrollment termination strictly blocks assistants (403), updates status to terminated, preserves data
- [ ] G4: Content access check verifies that a terminated student receives 403 ENROLLMENT_TERMINATED and active student receives 200
- [ ] G5: Monorepo typecheck, lint, and full test suite pass 100% green
