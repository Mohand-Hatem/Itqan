# Feature Concept Brief: Single-Use Access Code Batches (Phase 6, Step 6.5 — FR-E02)

**Status:** Synthesized Concept Brief (Multi-Lens Brainstorm)  
**Target Step:** Phase 6, Step 6.5 (`tasks/todo.md` line 107)  
**Functional Requirement:** FR-E02 (`docs/02-srs.md`)  
**Architecture Boundary:** Track A (Business Logic & REST API; UI deferred to Track B / Phase U per ADR-010)  
**Synthesizer Persona:** EGM Multi-Agent Swarm Compiler  

---

## 1. Plain-English Overview & Value Proposition

### 1.1 Plain-English Overview
In Egypt and the broader MENA education market, online digital payment processors (credit cards, Stripe, etc.) are frequently inaccessible, untrusted, or unusable for secondary school students and their parents. Educational monetization operates primarily via physical distribution networks: teachers, assistants, and local academic bookshops distribute printed vouchers (scratchcards, coupons, or printed slips) in exchange for physical cash.

Step 6.5 implements the backend 'digital mint' and lifecycle management for these offline course vouchers. A teacher selects a course, specifies a quantity (from 1 up to 500 codes), and provides an optional batch label (e.g., 'Fall 2026 — Dokki Center Hall A'). The system generates high-entropy, human-friendly access codes using Crockford's Base32 alphabet formatted as `XXXX-XXXX-XXXX`, stores only HMAC-SHA256 keyed digests in the database, and returns the plaintext codes alongside a pre-formatted CSV file **exactly once** in the creation response.

Subsequent operations allow authorized staff to list batches, inspect anonymized redemption statuses with physical serial numbers, and trigger a batch-level revocation kill-switch (invalidating all unsold/unredeemed vouchers while preserving legitimate enrollments for students who already activated their codes).

```
                      [ Teacher Dashboard ]
                                |
                  POST /api/code-batches (count <= 500)
                                |
                +---------------+---------------+
                |                               |
        (Crypto Pipeline)                (Database Store)
    Generate 60-bit Base32 codes      Store HMAC-SHA256 hashes only
    Format: XXXX-XXXX-XXXX            Assign sequential serial numbers (1..N)
    Build CSV export                  Zero plaintext retention in DB
                |                               |
                +---------------+---------------+
                                |
                   HTTP 201 Response (EXACTLY ONCE)
                   - Plaintext CSV & Code Array
                   (Teacher downloads & prints physical cards)
```

### 1.2 Value Proposition
* **Zero-Knowledge Compromise Defense:** Plaintext voucher codes never touch persistent storage. Even in the event of a catastrophic database dump or insider data exfiltration, unredeemed codes cannot be reconstructed or redeemed by attackers without the server-side HMAC secret.
* **Frictionless Physical Monetization:** Bridges the gap between offline cash transactions and online LMS access. Teachers can mint batches for physical retailers with complete inventory tracking.
* **Operational Control & Rapid Containment:** If a box of printed cards is stolen or lost during delivery to a center, the teacher can revoke the batch in a single click. Unredeemed codes are neutralized instantly, without disrupting already-enrolled students.
* **Human-Centered Ergonomics:** Codes are partitioned into three 4-character blocks and utilize Crockford Base32 to eliminate visual confusion between numerals and letters (`0/O`, `1/I/L`), accompanied by an automatic normalization engine that forgives typos and formatting variants.

---

## 2. Multi-Lens Brainstorm Synthesis

The feature hypothesis was subjected to analysis across seven specialized evaluation lenses. All findings are synthesized below:

### 2.1 UX & Ergonomics Lens (`egm-design`)
* **Ergonomics of Physical Scratchcards:** Students scratching cards with a coin frequently produce scuffed or partially legible characters. The code structure must avoid characters that smudge into ambiguity. Crockford Base32 excludes `I`, `L`, `O`, and `U`.
* **Delimiter Invariance:** Users naturally enter codes with or without hyphens, or with accidental spaces. Input validation must be delimiter-agnostic.
* **The 'One-Time Export' UX Trap:** Returning plaintext codes only once is a strict security mandate, but creates high anxiety for teachers. The UI layer (Phase U) must pair this API with an un-dismissible confirmation modal displaying a download progress state, a 'Copy to Clipboard' backup button, and clear bilingual warnings in Arabic and English (*'Save this file now. These codes can never be retrieved again.'*).
* **Batch Naming & Categorization:** Without an optional human-readable batch name, teachers managing dozens of batches across multiple classes will struggle to identify which CSV belongs to which physical distribution center.

### 2.2 Codebase Details Lens (`egm-codebase-details`)
* **Prisma Model Conventions:** IDs must use UUIDv7 (`@id @default(uuid(7)) @db.Uuid`), timestamp fields must use `timestamptz` (`@db.Timestamptz`), and table names must follow snake_case mapping (`@map("access_code_batches")`, `@map("access_codes")`).
* **Mandatory Tenancy Hook:** In `packages/database/src/tenant-extension.ts`, the `TENANT_MODELS` set strictly validates all models containing a `tenantId` column. Adding `AccessCodeBatch` and `AccessCode` requires immediate addition to `TENANT_MODELS`, or the test suite in `tenant-extension.spec.ts` fails on model count mismatch.
* **Testing Fixtures Sweep:** In `packages/database/src/testing/fixtures.ts`, every tenant model requires a factory in `TENANT_FIXTURES`. `isolation.int.spec.ts` automatically iterates through `TENANT_FIXTURES` to verify tenant barriers; omitting these fixtures breaks the database build pipeline.
* **Shared DTO Packages:** Request schemas and validation types belong in `packages/shared/src/schemas/code-batches.ts` and must be re-exported in `packages/shared/src/index.ts`.
* **API Architecture:** Follows existing NestJS modular layout: `apps/api/src/code-batches/` with `code-batches.controller.ts`, `code-batches.service.ts`, and `code-batches.module.ts`, registered in `apps/api/src/app.module.ts`.

### 2.3 System Architect & Long-Term Vision Lens (`egm-zoom-out`)
* **Bounded Contexts:** Step 6.5 must restrict its scope to **Minting, Listing, and Revoking**. The redemption phase belongs strictly to Step 6.6a (`/api/register-with-code` and `/api/codes/redeem`). Step 6.5 must establish clean database records and cryptographic contracts that Step 6.6a can consume without schema rework.
* **Database Write Scalability:** Generating a batch of 500 codes requires inserting 500 records. Using single individual inserts would cause 500 database round-trips. The service must utilize Prisma's `createMany` within a scoped transaction to execute bulk inserts in a single round-trip.
* **Indexing Footprint:** With high batch volumes, `access_codes` could grow into hundreds of thousands of rows. A lean compound index on `[tenant_id, batch_id, serial_number]` and a unique index on `code_hash` ensure sub-millisecond lookups without table-scan bloat.

### 2.4 Product & Clarity Lens (`egm-comprehension`)
* **Role Mental Model:** A voucher is an un-activated entitlement. It is not an enrollment. The voucher only transforms into an enrollment when a student successfully redeems it.
* **Revocation Semantics:** 'Revoking a batch' is an inventory invalidation tool, not an academic disciplinary tool. If a card is revoked before redemption, it is dead. If a card was already redeemed, the student holds a genuine `Enrollment` in `enrollments` table. Terminating a student's active course access is handled exclusively by Step 6.7 (`EnrollmentsService.terminate`), never as a side-effect of batch revocation.

### 2.5 Pragmatic Implementer Lens (`egm-implementation-readiness`)
* **60-bit Entropy Construction:** 60 bits provides 2^60 ~ 1.15 * 10^18 permutations. Generating 60 bits from Node.js `crypto.randomBytes(8)` and encoding via Crockford Base32 produces exactly 12 characters. Splitting into 3 blocks of 4 (`XXXX-XXXX-XXXX`) provides optimal legibility.
* **Secret Management:** Storage utilizes `createHmac("sha256", secret)`. The secret must be retrieved from an environment variable (`ACCESS_CODE_HMAC_SECRET`), falling back to `BETTER_AUTH_SECRET` in development environments, satisfying NFR-08.
* **CSV Format Structure:** The CSV output should contain standard headers: `Serial,Code,FormattedCode,CourseTitle,BatchId,CreatedAt`.
* **Transaction Safety:** Batch creation must be atomic: inserting the `AccessCodeBatch` row and all 500 `AccessCode` rows must succeed together or roll back completely.

### 2.6 Skeptical Architect Lens (`egm-structural`)
* **Hash Collision Handling:** Within a 60-bit space, the probability of an internal collision across 500 codes is roughly 1 * 10^-13. However, an in-memory `Set` during generation guarantees zero duplicates within a batch before database insertion. A database-level unique constraint on `code_hash` protects global integrity.
* **Supportability Without Plaintext:** If a teacher cannot see the codes, how do they identify which card a student is holding when providing phone support?
  * *Solution:* Each code receives an incrementing integer `serial_number` (1..N) within the batch and a 4-character unhashed prefix (`code_prefix`, e.g., `7K9M`). The printed card displays `#042 — 7K9M-2P4X-8W0B`. The teacher's dashboard displays `Serial 42: 7K9M-••••-•••• (Redeemed by student@example.com)`. Support staff can verify redemption status without needing the full secret.
* **Revocation Concurrency:** Batch revocation must execute an atomic SQL update: `UPDATE access_codes SET revoked_at = NOW() WHERE batch_id = $1 AND redeemed_at IS NULL AND revoked_at IS NULL`. This prevents race conditions with concurrent redemptions in Step 6.6a.

### 2.7 Inventive Catalyst Lens (`egm-inventive-catalyst`)
* **TRIZ Principle Application:** Deep synthesis of four key contradictions resolving physical-digital tensions (detailed in Section 3).

---

## 3. Contradictions Identified & Resolved (TRIZ Analysis)

| Contradiction | Opposing Demands | TRIZ Inventive Principle | Technical Resolution |
|---|---|---|---|
| **C1: Zero-Knowledge Security vs. Supportability** | Storing hashes prevents plaintext code leakage, but leaves support staff blind when assisting students with defective or queried cards. | **Principle 2 (Taking Out / Separation)** & **Principle 10 (Preliminary Action)** | **Separation of Credential from Identity:** Store a non-secret serial number (`serial_number: Int`) and public prefix (`code_prefix: String(4)`) alongside `code_hash`. The physical card displays both. Staff search by serial number and inspect `XXXX-••••-••••` with live redemption status without ever accessing the plaintext secret. |
| **C2: Zero-Retention Export vs. Network Transport Drops** | Codes must never be stored in plaintext on the server, but network drops or browser crashes during CSV export would permanently lose printed inventory. | **Principle 11 (Beforehand Cushioning)** & **Principle 24 (Intermediary)** | **Atomic Multi-Format Transport & Instant Re-Minting:** The `POST /api/code-batches` endpoint returns both the CSV text string and a structured JSON array of formatted codes in one atomic payload. If transport fails completely before receipt, the batch has 0 redemptions and can be revoked with a single click, allowing an immediate replacement batch to be minted without risk. |
| **C3: Batch Revocation vs. Enrolled Student Continuity** | A batch revocation must terminate an entire compromised batch of physical cards, but must not invalidate students who legitimately paid for and activated their cards prior to revocation. | **Principle 1 (Segmentation / Decoupling)** | **Decoupled Voucher vs. Entitlement Records:** The voucher (`access_codes`) is separate from the lifetime enrollment (`enrollments`). Revocation updates only codes `WHERE redeemed_at IS NULL AND revoked_at IS NULL`. The `enrollments` table is untouched, guaranteeing active students retain seamless access. |
| **C4: High Cryptographic Entropy vs. Human Transcription Error** | 60-bit cryptographic entropy requires 12+ characters, but manual typing on mobile keyboards leads to frequent transcription failures and support overhead. | **Principle 13 (The Other Way Round)** & **Principle 35 (Parameter Changes)** | **Crockford Normalization Pipeline:** Use Crockford Base32 (32 symbols = 5 bits/char = 12 chars = 60 bits). Format with hyphen chunking (`XXXX-XXXX-XXXX`). Implement a server-side normalization filter that strips hyphens/spaces, converts lowercase to uppercase, and maps visual aliases (`O/o -> 0`, `I/i/L/l -> 1`) before computing the HMAC hash. |

---

## 4. Database Architecture & Schema Specification

### 4.1 Prisma Schema Models
To be added to `packages/database/prisma/schema.prisma`:

```prisma
// Batch of access codes generated for a course (docs/04-database.md, FR-E02).
model AccessCodeBatch {
  id            String    @id @default(uuid(7)) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  courseId      String    @map("course_id") @db.Uuid
  name          String?   // Optional human label e.g. "Fall 2026 - Cairo Center"
  codeCount     Int       @map("code_count") // Total codes minted (1..500)
  redeemedCount Int       @default(0) @map("redeemed_count")
  revokedAt     DateTime? @map("revoked_at") @db.Timestamptz
  createdById   String    @map("created_by") @db.Uuid
  revokedById   String?   @map("revoked_by") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  tenant        Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  course        Course    @relation(fields: [courseId], references: [id], onDelete: Cascade)
  createdByUser User      @relation("BatchCreatedBy", fields: [createdById], references: [id], onDelete: Cascade)
  revokedByUser User?     @relation("BatchRevokedBy", fields: [revokedById], references: [id], onDelete: SetNull)

  codes         AccessCode[]

  @@index([tenantId, courseId, createdAt(sort: Desc)])
  @@index([tenantId, revokedAt])
  @@map("access_code_batches")
}

// Single-use course access code (HMAC-hashed, docs/04-database.md, FR-E02).
model AccessCode {
  id           String    @id @default(uuid(7)) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  batchId      String    @map("batch_id") @db.Uuid
  courseId     String    @map("course_id") @db.Uuid
  serialNumber Int       @map("serial_number") // Sequence 1..N within the batch
  codeHash     String    @unique @map("code_hash") // HMAC-SHA256 hex digest
  codePrefix   String    @map("code_prefix") // First 4 chars for support display (e.g. "7K9M")
  redeemedAt   DateTime? @map("redeemed_at") @db.Timestamptz
  redeemedBy   String?   @map("redeemed_by") @db.Uuid // User ID of student
  revokedAt    DateTime? @map("revoked_at") @db.Timestamptz
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz

  tenant         Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  batch          AccessCodeBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)
  course         Course          @relation(fields: [courseId], references: [id], onDelete: Cascade)
  redeemedByUser User?           @relation("CodeRedeemedBy", fields: [redeemedBy], references: [id], onDelete: SetNull)

  @@unique([tenantId, batchId, serialNumber])
  @@index([tenantId, batchId, redeemedAt, revokedAt])
  @@index([codeHash])
  @@map("access_codes")
}
```

### 4.2 Entity Relations & Integrity Rules
* **Cascade Semantics:** Deleting a tenant purges all its code batches and codes (`onDelete: Cascade`). Deleting a course cascades to its batches and codes. Deleting or suspending a staff user sets `revoked_by` or `redeemed_by` to `SetNull`.
* **Tenant Isolation System Extension:**
  1. Register `"AccessCodeBatch"` and `"AccessCode"` in `TENANT_MODELS` in `packages/database/src/tenant-extension.ts`.
  2. Implement fixture functions for both in `packages/database/src/testing/fixtures.ts`.
  3. Every query through `ScopedPrismaClient` will automatically bind `where: { tenantId }` and `data: { tenantId }`.

---

## 5. Cryptographic Pipeline Specification

### 5.1 Entropy Calculation & Alphabet
* **Entropy Requirement:** Minimum 60 bits of cryptographic randomness.
* **Alphabet:** Douglas Crockford's Base32 encoding: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (32 symbols = 5 bits per character).
* **Length:** Exactly 12 characters: 12 * 5 = 60 bits (2^60 = 1,152,921,504,606,846,976 combinations).
* **Display Format:** Three blocks of four characters separated by hyphens: `XXXX-XXXX-XXXX`.

### 5.2 Code Generation Pipeline
```ts
import { randomBytes, createHmac } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateCrockfordCode(): { raw: string; formatted: string; prefix: string } {
  // 8 random bytes = 64 bits. Mask top 4 bits to obtain exactly 60 bits.
  const buf = randomBytes(8);
  let value = buf.readBigUInt64BE(0) & 0x0FFF_FFFF_FFFF_FFFFn;

  let raw = "";
  for (let i = 0; i < 12; i++) {
    const index = Number(value & 0x1Fn);
    raw = CROCKFORD_ALPHABET[index] + raw;
    value >>= 5n;
  }

  const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  const prefix = raw.slice(0, 4);

  return { raw, formatted, prefix };
}
```

### 5.3 Normalization & Hashing Pipeline
Before computing HMAC-SHA256, user input passes through canonical normalization:
1. Strip all hyphens (`-`) and whitespace characters (`\s`).
2. Convert all characters to uppercase.
3. Canonicalize Crockford visual aliases:
   * `'O'` or `'o'` -> `'0'`
   * `'I'`, `'i'`, `'L'`, or `'l'` -> `'1'`
4. Assert length equals 12 and characters match `^[0-9A-HJKMNP-TV-Z]{12}$`.
5. Compute HMAC-SHA256 using server secret (`ACCESS_CODE_HMAC_SECRET`):

```ts
export function normalizeAccessCode(input: string): string {
  const cleaned = input
    .replace(/[-\s]/g, "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(cleaned)) {
    throw new BadRequestException({
      statusCode: 400,
      reason: "INVALID_CODE_FORMAT",
      message: "The provided code is invalid. Check for typos.",
    });
  }
  return cleaned;
}

export function hashAccessCode(normalizedCode: string, secret: string): string {
  return createHmac("sha256", secret).update(normalizedCode).digest("hex");
}
```

---

## 6. API Surface & Contract

All endpoints reside under the tenant hostname context (`<slug>.localhost` in dev, `<slug>.<root-domain>` in production).

### 6.1 POST `/api/code-batches` — Generate Batch
* **Access:** `@Roles("teacher")` (or Super Admin). Assistants: 403 Forbidden. Students: 403 Forbidden.
* **Payload (Zod: `CodeBatchCreateSchema`):**
  ```json
  {
    "courseId": "01944e82-7c3a-7a8b-9671-000000000001",
    "count": 100,
    "name": "Fall 2026 - Cairo Center"
  }
  ```
  *Constraints:* `count` integer >= 1 and <= 500. `name` optional string (max 100 chars). `courseId` must exist in current tenant and not be soft-deleted.
* **Response (HTTP 201 Created):**
  ```json
  {
    "batch": {
      "id": "01944e85-0001-7000-8000-000000000001",
      "courseId": "01944e82-7c3a-7a8b-9671-000000000001",
      "courseTitle": "Physics 101",
      "name": "Fall 2026 - Cairo Center",
      "codeCount": 100,
      "redeemedCount": 0,
      "revokedAt": null,
      "createdAt": "2026-11-12T15:00:00.000Z"
    },
    "csv": "Serial,Code,FormattedCode,CourseTitle,BatchId,CreatedAt\n1,7K9M2P4X8W0B,7K9M-2P4X-8W0B,Physics 101,01944e85-...,2026-11-12T15:00:00.000Z\n...",
    "codes": [
      { "serial": 1, "code": "7K9M-2P4X-8W0B" },
      { "serial": 2, "code": "8NP2-3K9Y-7M1A" }
    ]
  }
  ```
* **Audit Entry:** `action: "code_batch.create"`, `targetType: "code_batch"`, `meta: { courseId, count, name }`. Plaintext codes are strictly excluded from audit metadata.

### 6.2 GET `/api/code-batches` — List Batches
* **Access:** `@Roles("teacher")`. (Optionally accessible to `assistant` with read-only visibility).
* **Query Parameters:** `?courseId=&status=&cursor=&limit=` (limit default 20, max 100).
* **Response (HTTP 200 OK):**
  ```json
  {
    "items": [
      {
        "id": "01944e85-0001-7000-8000-000000000001",
        "courseId": "01944e82-7c3a-7a8b-9671-000000000001",
        "courseTitle": "Physics 101",
        "name": "Fall 2026 - Cairo Center",
        "codeCount": 100,
        "redeemedCount": 42,
        "isRevoked": false,
        "createdAt": "2026-11-12T15:00:00.000Z",
        "revokedAt": null
      }
    ],
    "nextCursor": null
  }
  ```

### 6.3 GET `/api/code-batches/:id/codes` — Inspect Batch Codes
* **Access:** `@Roles("teacher")` (or Super Admin).
* **Path Parameter:** `:id` (UUIDv7 batch ID).
* **Query Parameters:** `?status=all|unredeemed|redeemed|revoked&cursor=&limit=`.
* **Response (HTTP 200 OK):**
  Redacted representation only. Plaintext codes are never returned.
  ```json
  {
    "batchId": "01944e85-0001-7000-8000-000000000001",
    "items": [
      {
        "serial": 1,
        "codeMasked": "7K9M-••••-••••",
        "status": "redeemed",
        "redeemedAt": "2026-11-12T16:30:00.000Z",
        "redeemedBy": {
          "id": "01944e90-0000-7000-8000-000000000001",
          "email": "student@example.com",
          "name": "Omar Tarek"
        }
      },
      {
        "serial": 2,
        "codeMasked": "8NP2-••••-••••",
        "status": "unredeemed",
        "redeemedAt": null,
        "redeemedBy": null
      }
    ],
    "nextCursor": null
  }
  ```

### 6.4 POST `/api/code-batches/:id/revoke` — Revoke Unredeemed Codes
* **Access:** `@Roles("teacher")` (or Super Admin). Assistants: 403 Forbidden.
* **Path Parameter:** `:id` (UUIDv7 batch ID).
* **Behavior:** Atomic transaction:
  1. Checks batch exists in tenant and is not already revoked.
  2. Sets `access_code_batches.revokedAt = now()`, `revokedById = user.id`.
  3. Updates unredeemed codes:
     `UPDATE access_codes SET revoked_at = now() WHERE batch_id = :id AND redeemed_at IS NULL AND revoked_at IS NULL`
  4. Records audit log entry: `action: "code_batch.revoke"`, `meta: { revokedCodesCount, preservedEnrollmentsCount }`.
* **Response (HTTP 200 OK):**
  ```json
  {
    "id": "01944e85-0001-7000-8000-000000000001",
    "status": "revoked",
    "revokedCodesCount": 58,
    "preservedEnrollmentsCount": 42,
    "revokedAt": "2026-11-12T17:00:00.000Z"
  }
  ```

---

## 7. Security Model & Role Access Control Matrix

| Role | `POST /api/code-batches` (Mint) | `GET /api/code-batches` (List) | `GET /api/code-batches/:id/codes` (Audit) | `POST /api/code-batches/:id/revoke` (Kill-Switch) |
|---|---|---|---|---|
| **Super Admin** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **Teacher** | ✅ Allowed | ✅ Allowed | ✅ Allowed | ✅ Allowed |
| **Assistant** | ❌ 403 Forbidden | ⚠️ Read-Only (Audited) | ⚠️ Read-Only (Redacted) | ❌ 403 Forbidden |
| **Student** | ❌ 403 Forbidden | ❌ 403 Forbidden | ❌ 403 Forbidden | ❌ 403 Forbidden |
| **Unauthenticated** | ❌ 401 Unauthorized | ❌ 401 Unauthorized | ❌ 401 Unauthorized | ❌ 401 Unauthorized |

### 7.1 Financial Threat Mitigation
* **Assistant Minting Prohibition:** Access codes represent physical currency vouchers. Permitting assistants to generate batches creates an unacceptable vector for unauthorized off-the-books printing and embezzlement. Creation and revocation are strictly reserved for the `teacher` role.
* **HMAC Secret Key Separation:** Hashes are keyed with `ACCESS_CODE_HMAC_SECRET`. If a malicious actor dumps the PostgreSQL database, they cannot conduct offline GPU rainbow table attacks or pre-compute Crockford codes.
* **Zero Logging Guarantee:** Plaintext access codes are never passed to `AuditService`, `Logger`, console output, or error payloads.

---

## 8. Scope Boundaries: Goals vs. Non-Goals

### 8.1 In-Scope Goals (Step 6.5)
1. Prisma schema definitions for `AccessCodeBatch` and `AccessCode` with database migration.
2. Tenant extension registration in `TENANT_MODELS` and test fixture generator in `TENANT_FIXTURES`.
3. Cryptographic pipeline: 60-bit CSPRNG generator, Crockford Base32 formatter, normalization engine, and HMAC-SHA256 hasher.
4. Zod schemas in `packages/shared` for creation, listing, querying, and revocation.
5. NestJS controller, service, and module implementing the 4 endpoints.
6. Transactional single-roundtrip bulk generation and single-use CSV export.
7. End-to-end integration test suite covering generation, listing, inspection, revocation, tenant isolation, role authorization, and audit logging.

### 8.2 Explicit Non-Goals (Reserved for Future Steps)
* **Step 6.6a (Redemption API):**
  * `POST /api/register-with-code` (Public registration with access code + guardian consent).
  * `POST /api/codes/redeem` (Logged-in student code activation).
  * Concurrency lock and double-spend prevention on code redemption.
* **Track B / Step 6.6b (UI Components):**
  * Frontend Next.js screens, batch generation dialogs, CSV file download prompts, and redemption pages are deferred per ADR-010.

---

## 9. Concrete Acceptance Gates (G1 to G5 — Unlazy Ledger)

| Gate | Stage | Verification Commands & Evidence | Acceptance Criteria |
|---|---|---|---|
| **G1** | **Data Model & Schema Alignment** | `npm run build -w @itqan/database`<br>`npx vitest run packages/database/src/tenant-extension.spec.ts` | 1. `AccessCodeBatch` and `AccessCode` models defined with UUIDv7, UTC timestamptz, correct snake_case mappings.<br>2. `TENANT_MODELS` contains both models; extension spec passes 100%.<br>3. `TENANT_FIXTURES` contains both factories. |
| **G2** | **Cryptographic & Normalization Pipeline** | `npx vitest run apps/api/src/code-batches/crypto.spec.ts` | 1. Generator produces exactly 12 Crockford Base32 characters formatted as `XXXX-XXXX-XXXX`.<br>2. Zero visual confusion characters (`I, L, O, U` excluded).<br>3. Normalization correctly transforms `o/O -> 0`, `i/l/I/L -> 1`, and strips delimiters.<br>4. HMAC-SHA256 hex output matches keyed test vectors. |
| **G3** | **API Surface & Transaction Integrity** | `npx vitest run apps/api/src/code-batches/code-batches.int.spec.ts` | 1. `POST /api/code-batches` creates 500 codes in one atomic transaction.<br>2. Response includes batch metadata, pre-formatted CSV, and plaintext codes.<br>3. Subsequent queries to DB verify plaintext codes are NOT stored (only 64-char hashes).<br>4. Redacted listing returns masked `XXXX-••••-••••` with serial numbers. |
| **G4** | **Revocation & Isolation Barriers** | `npx vitest run apps/api/src/code-batches/code-batches.int.spec.ts`<br>`npx vitest run apps/api/src/testing/isolation.int.spec.ts` | 1. Revoking a batch sets `revokedAt` on unredeemed codes only.<br>2. Simulated active enrollments remain completely unaffected after batch revocation.<br>3. Cross-tenant test proves Tenant A cannot view or revoke Tenant B's batches (returns 404).<br>4. Role barrier proves Assistants and Students receive 403 on mint and revoke. |
| **G5** | **Zero-Regression Full Suite Verification** | `npm run typecheck`<br>`npm test` | 1. Full monorepo TypeScript compilation succeeds without errors.<br>2. Entire unit and integration test suite across all packages and apps passes 100% green. |

---

## 10. Reviewer Consensus & Sign-Off Matrix

| Reviewer Lens | Specialist Title | Status | Finding / Recommendation Addressed |
|---|---|---|---|
| `egm-design` | UX & Ergonomics Brainstormer | Completed | Delimiter-agnostic normalization and one-time CSV modal UX warnings codified. |
| `egm-codebase-details` | Codebase Details Brainstormer | Completed | Strict enforcement of `TENANT_MODELS` and `TENANT_FIXTURES` requirements captured. |
| `egm-zoom-out` | System Architect Brainstormer | Completed | Clean separation between Step 6.5 (minting) and Step 6.6a (redemption) established. |
| `egm-comprehension` | Product & Clarity Brainstormer | Completed | Clear distinction between voucher records and enrollment records articulated. |
| `egm-implementation-readiness` | Pragmatic Implementer | Completed | Complete 60-bit Crockford algorithm, HMAC hashing, and Zod schemas specified. |
| `egm-structural` | Skeptical Architect Brainstormer | Completed | Serial numbers and public prefixes added to eliminate the zero-knowledge support paradox. |
| `egm-inventive-catalyst` | Inventive Catalyst Brainstormer | Completed | Four fundamental contradictions resolved using TRIZ principles. |

*Delivered by EGM Synthesizer Persona to Elephant Orchestrator.*