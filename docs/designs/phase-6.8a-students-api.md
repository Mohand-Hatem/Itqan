# Design Document: Phase 6, Step 6.8a — Students List and Detail API

**Target Step:** Phase 6, Step 6.8a (`tasks/todo.md` line 111)  
**Functional Requirements:** `FR-D01`, `FR-D02`, `docs/07-api.md § People`  
**Architecture Boundary:** Track A (Business Logic & REST API; UI deferred to Track B / Phase U per ADR-010)

---

## 1. Overview & Requirements

Teachers and assistants require administrative visibility into their enrolled students.
Step 6.8a delivers:
1. **Searchable & Filterable Student Directory (`GET /api/students`)**:
   - Query filters: search query `q` (matching name, email, or phone), membership `status` (`active` vs `suspended`), `courseId` filter, and cursor-based pagination.
   - Response includes core profile, device limit, guardian consent timestamp, and enrolled courses count.
2. **Comprehensive Student Detail Inspector (`GET /api/students/:membershipId`)**:
   - Aggregates the student's complete profile on the tenant:
     - Profile metadata (name, email, verification state, phone, membership status, maxDevices, guardian consent).
     - Course enrollments (course title, status `active`/`terminated`, grant source `invitation`/`code`/`manual`, timestamps).
     - Registered devices (device ID, status `active`/`pending`/`revoked`, timestamps).
     - Active sessions on this tenant (session ID, device binding, expiry).
     - Grades and Payments placeholders (empty arrays until Phase 8 and Step 6.9a respectively).
3. **Strict Multi-Tenant Isolation & Role Access Control**:
   - Only **Teacher** and **Assistant** can search or view students. Students receive `403 ROLE_FORBIDDEN`.
   - Querying a non-student membership (teacher or assistant) returns `404 NOT_FOUND`.
   - Cross-tenant requests (querying another tenant's student) return `404 NOT_FOUND`.

---

## 2. API Surface Specification

### 2.1 `GET /api/students`
- **Access:** `@Roles("teacher", "assistant")`
- **Query Parameters (Zod: `StudentListQuerySchema`):**
  - `q?: string` (case-insensitive substring match on `user.name`, `user.email`, `membership.phone`)
  - `status?: "all" | "active" | "suspended"` (default `"all"`)
  - `courseId?: UUID` (filters students who have an enrollment in the specified course)
  - `cursor?: UUID` (pagination cursor: `membership.id`)
  - `limit?: number` (1..100, default 20)
- **Response (`200 OK`):**
  ```json
  {
    "items": [
      {
        "membershipId": "01944e82-...",
        "userId": "01944e82-...",
        "name": "Sarah Ahmed",
        "email": "sarah@example.com",
        "phone": "+201012345678",
        "status": "active",
        "maxDevices": 1,
        "guardianConsentAt": "2026-11-12T15:00:00.000Z",
        "createdAt": "2026-11-12T15:00:00.000Z",
        "enrolledCoursesCount": 2
      }
    ],
    "nextCursor": null
  }
  ```

### 2.2 `GET /api/students/:membershipId`
- **Access:** `@Roles("teacher", "assistant")`
- **Path Param:** `membershipId` (UUID)
- **Response (`200 OK`):**
  ```json
  {
    "profile": {
      "membershipId": "01944e82-...",
      "userId": "01944e82-...",
      "name": "Sarah Ahmed",
      "email": "sarah@example.com",
      "emailVerified": true,
      "phone": "+201012345678",
      "status": "active",
      "maxDevices": 1,
      "guardianConsentAt": "2026-11-12T15:00:00.000Z",
      "createdAt": "2026-11-12T15:00:00.000Z"
    },
    "courses": [
      {
        "enrollmentId": "01944e85-...",
        "courseId": "01944e80-...",
        "title": "Physics 101",
        "status": "active",
        "source": "code",
        "enrolledAt": "2026-11-12T15:30:00.000Z",
        "terminatedAt": null
      }
    ],
    "devices": [
      {
        "id": "01944e86-...",
        "status": "active",
        "createdAt": "2026-11-12T15:10:00.000Z"
      }
    ],
    "sessions": [
      {
        "id": "01944e87-...",
        "deviceId": "01944e86-...",
        "expiresAt": "2026-12-12T15:10:00.000Z",
        "createdAt": "2026-11-12T15:10:00.000Z"
      }
    ],
    "grades": [],
    "payments": []
  }
  ```

---

## 3. Concrete Acceptance Gates (G1 to G5)

- [ ] G1: Shared Zod contract `StudentListQuerySchema` defined in `@itqan/shared` and compiles cleanly
- [ ] G2: Student directory search and filtering integration tests pass 100% (text search, status filter, courseId filter, cursor pagination)
- [ ] G3: Student detail inspector returns full aggregate (profile, courses, devices, sessions) for valid student
- [ ] G4: Role restrictions and tenant isolation tests pass (staff/other tenant return 404, students get 403)
- [ ] G5: Full monorepo typecheck, lint, and full test suite pass with zero regressions
