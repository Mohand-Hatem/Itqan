# Multi-Lens Synthesized Concept Brief: Course Access Code Redemption API (Step 6.6a)

**Target Step:** Phase 6, Step 6.6a (`FR-E03`, `FR-A05`, `FR-A06`, `FR-E04`)  
**Mode:** BRAINSTORM  
**Lenses Synthesized:** `egm-design`, `egm-codebase-details`, `egm-zoom-out`, `egm-comprehension`, `egm-implementation-readiness`, `egm-structural`, `egm-inventive-catalyst`

---

## Reviewer Lens Participation Matrix

| Reviewer Lens | Persona Title | Focus Domain | Status |
| :--- | :--- | :--- | :--- |
| `egm-design` | UX & Ergonomics Brainstormer | Error ergonomics, voucher entry flow, clear reason codes | completed |
| `egm-codebase-details` | Skeptical Architect Brainstormer | Crypto reuse, atomic SQL updates, batch counter synchronization | completed |
| `egm-zoom-out` | System Ecology Brainstormer | Cross-tenant membership lifecycle, Better Auth session invariants | completed |
| `egm-comprehension` | First-Principles Brainstormer | Core value proposition, offline retail economics, zero token leakage | completed |
| `egm-implementation-readiness` | Test & Gatekeeper Brainstormer | Concurrency harness, test assertions, Zod schemas, fixtures | completed |
| `egm-structural` | Data Model & Contract Brainstormer | Prisma transaction isolation, entity relationships, audit logging | completed |
| `egm-inventive-catalyst` | TRIZ Contradiction Resolver | Concurrency locking, duplicate email rollback, code burn timing | completed |

---

## 1. Plain-English Overview & Value Proposition

In the Egyptian tutoring ecosystem, many students pay teachers offline (in cash at physical educational centers, bookstores, or local academies) and receive printed paper cards or scratch vouchers containing a 12-character alphanumeric code. 

**Step 6.6a delivers the backend business logic and secure API endpoints** that allow these offline vouchers to be redeemed for instant course access:
1. **New Students (`POST /api/register-with-code`)**: A student with no prior account enters their voucher code alongside their registration details. In a single atomic operation, the platform validates their code, checks minor guardian consent, creates their account, provisions their student membership, grants them lifetime course enrollment, and sends a verification email.
2. **Existing Students (`POST /api/codes/redeem`)**: A student already possessing an account logs in and redeems a code directly from within their dashboard. The system validates the code, provisions a student membership on the target tenant if they are joining a new academy, and activates (or reactivates) their course enrollment.

### Value Proposition
- **Zero Double-Spending**: Course codes represent cash-equivalent value. Atomic database transactions guarantee that parallel redemption attempts (whether malicious or accidental double-clicks) result in strictly one winner.
- **Accidental Waste Protection**: If an existing student mistakenly inputs a code for a course they are already actively enrolled in, the system halts with a friendly `ALREADY_ENROLLED` error and **does not burn or consume the code**, allowing the student to return or re-gift the voucher.
- **Bulletproof Input Ergonomics**: Leverages Crockford Base32 normalization to forgive typos (e.g., lowercase letters, misplaced hyphens, typing `O` instead of `0`, or `I`/`L` instead of `1`).

---

## 2. Contradictions Identified & Resolved (TRIZ / Systematic Synthesis)

### Contradiction 1: High-Concurrency Double-Spend vs. Multi-Record Business Logic
* **Conflict**: To enroll a student, the server must create or update users, memberships, enrollments, audit logs, and batch counters across multiple tables. If multiple requests arrive in parallel for the same code, standard read-then-write logic creates a Time-of-Check to Time-of-Use (TOCTOU) race condition.
* **Inventive Resolution (TRIZ Principle 10 - Prior Action & Principle 24 - Intermediary)**:  
  Execute an atomic, single-statement conditional claim inside an interactive Prisma database transaction (`systemPrisma.$transaction`):
  ```sql
  UPDATE access_codes
  SET redeemed_at = NOW(), redeemed_by = $userId
  WHERE code_hash = $hash
    AND redeemed_at IS NULL
    AND revoked_at IS NULL;
  ```
  Postgres row-level write locks instantly serialize conflicting updates. If `claimed.count === 0`, the transaction immediately aborts with `409 Conflict (CODE_NOT_AVAILABLE)` before executing any expensive user creation or enrollment logic.

### Contradiction 2: Duplicate Email Collision during Unauthenticated Registration
* **Conflict**: A student who already has an account might mistakenly use the public `/api/register-with-code` registration form instead of logging in. If the code is claimed before email uniqueness is verified, an email collision error could leave the code burned while leaving the user unregistered.
* **Inventive Resolution (TRIZ Principle 22 - Blessing in Disguise / ACID Rollback)**:  
  Email uniqueness is checked pre-flight against `users`. Furthermore, all operations (code claim, user creation, account setup, membership, enrollment) reside inside the same ACID transaction boundary. If user creation fails on unique constraints, the transaction rolls back cleanly, returning `409 Conflict (USER_ALREADY_EXISTS)` with guidance to sign in, leaving the code unredeemed and available.

### Contradiction 3: Code Consumption vs. Email Verification Requirement (FR-A01)
* **Conflict**: FR-A01 mandates that student emails must be verified before their first login. If code redemption waits until the email link is clicked, the student could hold a claimed code in limbo or abandon verification, leaving the teacher unable to account for the voucher. If the code is consumed immediately, the student might mistype their email and lose access.
* **Inventive Resolution (TRIZ Principle 19 - Periodic / Staged Action)**:  
  Follow the deliberate architecture decision documented in `docs/06-flows.md §2`: The access code is permanently claimed at registration (`redeemedAt = NOW()`), binding entitlement immediately to the newly created user record. The user is created with `emailVerified = false`, and a verification email is dispatched. The student cannot log in until verified, but their course seat is guaranteed. If the student made an email typo, staff/teacher can resend verification or rectify the account via the administrative dashboard.

### Contradiction 4: Cross-Tenant Membership vs. Already-Enrolled Protection
* **Conflict**: A user identity is global across the platform (`users` table), but enrollments belong to a specific tenant membership. If an active student buys a code for a course they already own, claiming it wastes money. If an existing student from Tenant A buys a code for Tenant B, they need a new membership on Tenant B.
* **Inventive Resolution (TRIZ Principle 7 - Nested Doll)**:  
  On authenticated redemption (`POST /api/codes/redeem`):
  1. Inspect existing enrollments for the student on `code.courseId`.
  2. If an enrollment exists with `status === 'active'`, reject immediately with `400 Bad Request (ALREADY_ENROLLED)`. Do **not** claim the code.
  3. If an enrollment exists with `status === 'terminated'`, reactivate it to `status = 'active'`, update `source = 'code'`, and claim the code.
  4. If no membership exists on the code's tenant, automatically create the `student` membership for that user on that tenant.

---

## 3. Normalization Pipeline Reuse from Step 6.5

Step 6.6a directly reuses the cryptographic normalization and hashing functions established in `apps/api/src/code-batches/crypto.ts`:

1. **`normalizeAccessCode(input: string): string`**:
   - Strips all hyphens (`-`) and whitespace.
   - Converts all lowercase characters to uppercase.
   - Maps visually ambiguous glyphs: `O` &rarr; `0`, `I` &rarr; `1`, `L` &rarr; `1`.
   - Validates that the normalized string exactly matches `/^[0-9A-HJKMNP-TV-Z]{12}$/` (Crockford Base32 alphabet: 32 symbols, avoiding `I`, `L`, `O`, `U`).
   - Rejects non-conforming inputs with `400 Bad Request (INVALID_CODE_FORMAT)`.
2. **`hashAccessCode(normalizedCode: string): string`**:
   - Derives a deterministic HMAC-SHA256 hex digest using `ACCESS_CODE_HMAC_SECRET || BETTER_AUTH_SECRET`.
   - The plain code is never queried or stored in Postgres; lookups occur solely against `access_codes.code_hash`.
3. **Tenant Scoping**:
   - When a code hash matches an `access_codes` record, the system verifies `code.tenantId === requestTenantId`. Cross-tenant voucher hijacking across separate academy subdomains is rejected with `404 Not Found (CODE_NOT_FOUND)`.

---

## 4. API Surface Specification

### 4.1. `POST /api/register-with-code`
- **Access**: Public (`@Public()`), tenant context resolved from `Host` header.
- **Request Body (Zod: `CodeRegisterSchema`)**:
  ```ts
  {
    code: string;             // 12-char Crockford code (e.g., "ABCD-EFGH-JKMN")
    name: string;             // Student full name (2–100 chars)
    email: string;            // Valid email address (lowercased, trimmed)
    password: string;         // Password (min 8 chars)
    phone?: string;           // Optional contact phone
    isMinor?: boolean;        // Default false
    guardianConsent?: boolean;// Default false; required true if isMinor is true
  }
  ```
- **Validation**:
  - `refine((data) => !data.isMinor || data.guardianConsent, { message: "Guardian consent is required for students under 18." })`.
- **Execution Flow (Transaction)**:
  1. Normalize and hash `code`.
  2. Verify tenant context from host.
  3. Query `accessCode`: must exist, match `tenantId`, have `revokedAt === null`, and `redeemedAt === null`.
  4. Verify `course`: must exist, match `tenantId`, and `deletedAt === null`.
  5. Check `user`: if `users` table already has `email`, throw `409 Conflict (USER_ALREADY_EXISTS)`.
  6. **Atomic Claim**:
     ```ts
     const claimed = await tx.accessCode.updateMany({
       where: { id: code.id, redeemedAt: null, revokedAt: null },
       data: { redeemedAt: new Date() },
     });
     if (claimed.count === 0) throw new ConflictException({ reason: "CODE_NOT_AVAILABLE" });
     ```
  7. Hash password via Better Auth context: `await authContext.password.hash(input.password)`.
  8. Create `User`: `{ email, name, emailVerified: false, status: 'active', maxDevices: 1 }`.
  9. Create `Account`: `{ userId, accountId: userId, providerId: 'credential', password: passwordHash }`.
  10. Update `AccessCode`: set `redeemedBy = user.id`.
  11. Increment `AccessCodeBatch`: `tx.accessCodeBatch.update({ where: { id: code.batchId }, data: { redeemedCount: { increment: 1 } } })`.
  12. Create `Membership`: `{ tenantId, userId, role: 'student', phone, guardianConsentAt: input.guardianConsent ? new Date() : null }`.
  13. Create `Enrollment`: `{ tenantId, membershipId, courseId: code.courseId, source: 'code', grantedBy: code.batch.createdById }`.
  14. Write `AuditLog`: `{ action: 'code.register', actorUserId: user.id, targetType: 'access_code', targetId: code.id, meta: { courseId, batchId } }`.
  15. **Post-Commit**: Dispatch verification email (`sendVerificationEmail({ to: user.email, url, token, name: user.name })`).
- **Response**: `201 Created`
  ```json
  {
    "userId": "018f...uuid",
    "membershipId": "018f...uuid",
    "courseId": "018f...uuid",
    "email": "student@example.com"
  }
  ```

---

### 4.2. `POST /api/codes/redeem`
- **Access**: Authenticated (`Role: student`), device cookie verified, tenant context from `Host`.
- **Request Body (Zod: `CodeRedeemSchema`)**:
  ```ts
  {
    code: string; // 12-char Crockford code
  }
  ```
- **Execution Flow (Transaction)**:
  1. Normalize and hash `code`.
  2. Verify tenant context from host.
  3. Validate caller: if `user.status === 'suspended'`, throw `403 Forbidden (USER_SUSPENDED)`.
  4. Query `accessCode`: must exist, match `tenantId`, have `revokedAt === null`, and `redeemedAt === null`.
  5. Check `membership`:
     - If exists and `membership.status === 'suspended'`, throw `403 Forbidden (MEMBERSHIP_SUSPENDED)`.
     - If missing, create `Membership` on this tenant (`role: 'student'`).
  6. **Check Existing Enrollment in Course**:
     - Query `enrollment` where `membershipId = membership.id` and `courseId = code.courseId`.
     - If found and `status === 'active'`: throw `400 Bad Request (ALREADY_ENROLLED)`. (Code remains unredeemed).
  7. **Atomic Claim**:
     ```ts
     const claimed = await tx.accessCode.updateMany({
       where: { id: code.id, redeemedAt: null, revokedAt: null },
       data: { redeemedAt: new Date(), redeemedBy: authUser.id },
     });
     if (claimed.count === 0) throw new ConflictException({ reason: "CODE_NOT_AVAILABLE" });
     ```
  8. Increment `AccessCodeBatch.redeemedCount`.
  9. **Enrollment Upsert**:
     - If previous enrollment existed with `status === 'terminated'`: update to `status = 'active'`, `source = 'code'`, `updatedAt = now()`.
     - If no previous enrollment: create new `Enrollment` with `status = 'active'`, `source = 'code'`, `grantedBy = code.batch.createdById`.
  10. Write `AuditLog`: `{ action: 'code.redeem', actorUserId: authUser.id, targetType: 'access_code', targetId: code.id, meta: { courseId, batchId } }`.
- **Response**: `200 OK`
  ```json
  {
    "membershipId": "018f...uuid",
    "courseId": "018f...uuid",
    "courseTitle": "Physics 101",
    "status": "active"
  }
  ```

---

## 5. Security Model & Role Access Control

| Endpoint | Caller Role | Condition | Response on Violation |
| :--- | :--- | :--- | :--- |
| `POST /api/register-with-code` | Public (`P`) | Minor without guardian consent | `400 Bad Request (GUARDIAN_CONSENT_REQUIRED)` |
| `POST /api/register-with-code` | Public (`P`) | Malformed code format | `400 Bad Request (INVALID_CODE_FORMAT)` |
| `POST /api/register-with-code` | Public (`P`) | Code not found / other tenant | `404 Not Found (CODE_NOT_FOUND)` |
| `POST /api/register-with-code` | Public (`P`) | Code revoked or already redeemed | `409 Conflict (CODE_NOT_AVAILABLE)` |
| `POST /api/register-with-code` | Public (`P`) | Email already registered | `409 Conflict (USER_ALREADY_EXISTS)` |
| `POST /api/codes/redeem` | Student (`S`) | Unauthenticated request | `401 Unauthorized (UNAUTHORIZED)` |
| `POST /api/codes/redeem` | Student (`S`) | User or membership suspended | `403 Forbidden (USER_SUSPENDED / MEMBERSHIP_SUSPENDED)` |
| `POST /api/codes/redeem` | Staff (`T`, `A`) | Teacher / Assistant calling student endpoint | `403 Forbidden (ROLE_FORBIDDEN)` |
| `POST /api/codes/redeem` | Student (`S`) | Already holds active course enrollment | `400 Bad Request (ALREADY_ENROLLED)` |
| `POST /api/codes/redeem` | Student (`S`) | Code revoked or redeemed | `409 Conflict (CODE_NOT_AVAILABLE)` |

### Sensitive Data Safeguards
- **Zero Raw Code Storage / Logging**: The raw code is never persisted in database columns or written into audit log metadata. Audit logs record only `targetType: 'access_code'`, `targetId: code.id`, and `batchId`.
- **Tenant Isolation Guarantee**: Database queries utilize tenant-scoped Prisma client or enforce explicit `tenant_id` WHERE clauses. A voucher generated in Tenant A cannot be redeemed on Tenant B.

---

## 6. Goals vs. Non-Goals

### Goals (Step 6.6a — Track A Business Logic)
1. Complete Zod schemas in `@itqan/shared` for registration and authenticated redemption payloads.
2. Implement backend service and controller methods in NestJS `apps/api`.
3. Support seamless Crockford Base32 normalization and HMAC-SHA256 hash lookup.
4. Eliminate race conditions via single-statement atomic updates inside interactive Prisma transactions.
5. Provide automatic cross-tenant membership provisioning and terminated enrollment reactivation.
6. Protect active enrollments with non-consuming `400 ALREADY_ENROLLED` responses.
7. Deliver a comprehensive integration test suite (`code-redemption.int.spec.ts`) covering parallel load, edge cases, and tenant isolation.

### Non-Goals (Deferred to Step 6.6b — Track B Phase U)
1. **No UI Pages or Components**: Step 6.6b will build the public `/register-with-code` screen, the student portal `/redeem` modal, and voucher input formatting components after the design system is selected (ADR-010).
2. **No QR Code Camera Scanner**: Optical scanning of voucher cards from mobile devices is deferred to post-MVP.
3. **No Dynamic Multi-Course Bundles**: Single access codes grant access to exactly one course (`course_id` on the batch). Multi-course voucher bundles are outside MVP scope.

---

## 7. Concrete Acceptance Gates (G1 to G5)

Following the Unlazy Execution Ledger format:

* **Gate G1 (Normalization & Cryptographic Lookup)**:  
  Both endpoints accept raw codes in varied formatting (e.g. `abcd-efgh-jkmn`, `ABCD EFGH JKMN`, `abcdefghjkmn`, with `0`/`O` and `1`/`I`/`L` substitutions). Normalization produces a 12-char Crockford canonical string; HMAC-SHA256 digest accurately matches `access_codes.code_hash`. Invalid lengths or non-Crockford characters fail with `400 INVALID_CODE_FORMAT`.
* **Gate G2 (Concurrency & Anti-Double-Spend)**:  
  A test executing 5 parallel concurrent requests to `/api/register-with-code` and `/api/codes/redeem` on a single valid access code produces **exactly 1 success (201/200)** and **4 conflict rejections (409 CODE_NOT_AVAILABLE)**. The database verifies `redeemedCount = 1` on the parent batch and exactly one enrollment created.
* **Gate G3 (Public Registration Integrity & Email Verification Trigger)**:  
  `POST /api/register-with-code` enforces minor guardian consent (`400` if `isMinor: true, guardianConsent: false`), creates a new user with `emailVerified: false`, stores scrypt password hash in `accounts`, creates student membership, grants active enrollment, and writes a verification token to the test mailbox. Duplicate email returns `409 USER_ALREADY_EXISTS` leaving the code unredeemed.
* **Gate G4 (In-Account Redemption & Already-Enrolled Protection)**:  
  `POST /api/codes/redeem` allows an authenticated student to redeem a code. If the student already holds an active enrollment, the API returns `400 ALREADY_ENROLLED` and the code remains unredeemed. If the enrollment was terminated, it is reactivated to active. If caller is suspended, returns `403`.
* **Gate G5 (Auditability & Tenant Isolation)**:  
  Every successful redemption writes an audit log entry (`code.register` or `code.redeem`) containing zero raw code strings in metadata. Cross-tenant redemption attempts (submitting Tenant B's voucher to Tenant A's host) return `404 CODE_NOT_FOUND`. All unit and integration tests pass green.

---
*Deliverable generated by EGM Synthesizer Persona.*