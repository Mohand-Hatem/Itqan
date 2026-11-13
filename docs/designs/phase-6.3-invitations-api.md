# Phase 6.3: Invitations API (Student Invitation & Atomic Redemption)

* **Author:** Ahmed-Abd-EL-Kareem
* **Date:** 2026-11-12
* **Target Step:** Phase 6, Step 6.3 (`tasks/todo.md`)
* **Status:** Multi-Lens Synthesized Concept Brief (RFC)

---

## 1. Overview

Phase 6.3 implements the primary onboarding gateway for Itqan LMS. Because public self-registration is explicitly disabled (FR-A05), email invitations are the required method for onboarding students.

A teacher or assistant creates an invitation for an email address with one or more courses. Links expire after 72 hours, are single-use, and can be resent or revoked (FR-E01). Students can be new users who register through the invitation link with guardian consent fields (FR-A06, FR-E03) or existing users who accept the invitation while signed in.

Redemption is strictly atomic: parallel attempts to redeem the same invitation token guarantee exactly one successful redemption (eliminating TOCTOU race conditions).

---

## 2. Technical Architecture & Data Model

### 2.1 Database Schema (`packages/database/prisma/schema.prisma`)

```prisma
enum EnrollmentStatus {
  active
  terminated
}

enum EnrollmentSource {
  invitation
  code
  manual
}

model Invitation {
  id         String    @id @default(uuid(7)) @db.Uuid
  tenantId   String    @map("tenant_id") @db.Uuid
  email      String
  tokenHash  String    @unique @map("token_hash")
  courseIds  String[]  @map("course_ids") @db.Uuid
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz
  redeemedAt DateTime? @map("redeemed_at") @db.Timestamptz
  redeemedBy String?   @map("redeemed_by") @db.Uuid
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz
  createdBy  String    @map("created_by") @db.Uuid
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt  DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  tenant         Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  createdByUser  User   @relation("InvitationCreatedBy", fields: [createdBy], references: [id], onDelete: Cascade)
  redeemedByUser User?  @relation("InvitationRedeemedBy", fields: [redeemedBy], references: [id], onDelete: SetNull)

  @@index([tenantId, email])
  @@index([tenantId, expiresAt])
  @@index([tenantId, redeemedAt])
  @@map("invitations")
}

model Enrollment {
  id           String           @id @default(uuid(7)) @db.Uuid
  tenantId     String           @map("tenant_id") @db.Uuid
  membershipId String           @map("membership_id") @db.Uuid
  courseId     String           @map("course_id") @db.Uuid
  status       EnrollmentStatus @default(active)
  source       EnrollmentSource
  grantedBy    String           @map("granted_by") @db.Uuid
  terminatedBy String?          @map("terminated_by") @db.Uuid
  terminatedAt DateTime?        @map("terminated_at") @db.Timestamptz
  createdAt    DateTime         @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime         @updatedAt @map("updated_at") @db.Timestamptz

  tenant           Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  membership       Membership @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  course           Course     @relation(fields: [courseId], references: [id], onDelete: Cascade)
  grantedByUser    User       @relation("EnrollmentGrantedBy", fields: [grantedBy], references: [id], onDelete: Cascade)
  terminatedByUser User?      @relation("EnrollmentTerminatedBy", fields: [terminatedBy], references: [id], onDelete: SetNull)

  @@unique([membershipId, courseId])
  @@index([tenantId, status])
  @@index([courseId, status])
  @@map("enrollments")
}
```

### 2.2 Tenant Isolation Registration
- In `packages/database/src/tenant-extension.ts`: Add `"Invitation"` and `"Enrollment"` to `TENANT_MODELS`.
- In `packages/database/src/testing/fixtures.ts`: Add generator functions for both to `TENANT_FIXTURES`.

### 2.3 Cryptographic Security & Atomic Claim Pattern
- **Token Generation:** 32 random bytes (`crypto.randomBytes(32).toString("base64url")`).
- **Token Storage:** Raw token is never stored or logged. Stored as `tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex")`.
- **Atomic Claim Pattern:** To prevent race conditions, claiming uses an atomic conditional update:
  ```typescript
  const result = await tx.invitation.updateMany({
    where: {
      tokenHash,
      tenantId,
      redeemedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      redeemedAt: new Date(),
    },
  });
  if (result.count === 0) {
    throw new ConflictException({
      statusCode: 409,
      reason: "INVITATION_NOT_AVAILABLE",
      message: "This invitation link is invalid, expired, revoked, or has already been used.",
    });
  }
  ```
  Only one concurrent transaction can succeed; others receive 409 `INVITATION_NOT_AVAILABLE`.

### 2.4 API Surface (`apps/api/src/invitations/`)

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/invitations` | Staff (T, A) | Create invitation, generate token, send Resend email. 201 Created. |
| `GET` | `/api/invitations` | Staff (T, A) | Paginated list with status filter (`pending`, `redeemed`, `revoked`, `expired`). |
| `POST` | `/api/invitations/:id/resend` | Staff (T, A) | Rotate token, reset 72h window, re-send email. 200 OK. |
| `POST` | `/api/invitations/:id/revoke` | Staff (T, A) | Sets `revokedAt = now()`. 200 OK. |
| `GET` | `/api/invitations/check?token=` | Public | **Idempotent read-only validation:** returns target email, tenant info, course titles, without consuming the token. |
| `POST` | `/api/register` | Public | Atomic redemption for new student: creates User (with `emailVerified: true`), Account, Membership, Enrollments. |
| `POST` | `/api/invitations/accept` | Student | Atomic redemption for existing user: validates strict email match, creates Membership and Enrollments. |

---

## 3. Goals vs. Non-Goals

### In-Scope Goals (Step 6.3):
1. Migration adding `invitations` and `enrollments` tables.
2. Updating `TENANT_MODELS` and `TENANT_FIXTURES` with 100% passing isolation tests.
3. Shared Zod contracts in `@itqan/shared` for invitation creation, check, register, and accept.
4. Resend email templates (Arabic RTL default, English LTR) in `packages/auth`.
5. Atomic redemption with single-statement conditional updates.
6. Guardian consent handling for minors (FR-A06) saving `guardianConsentAt` on `Membership`.
7. Implicit email verification for new users registering through valid invitations.
8. Comprehensive Vitest suite testing expired, reused, revoked, wrong email, and parallel double-redeem race conditions.

### Out-of-Scope Non-Goals:
* `/join` frontend page (UI Track B, Step 6.4).
* Access code batches and code redemption (Steps 6.5 and 6.6a).
* Manual enrollment termination endpoint (Step 6.7).
* Offline payment tracking (Step 6.9a).

---

## 4. Key Design Decisions

1. **Scanner-Resilient Check:** `GET /invitations/check` is completely read-only and idempotent so enterprise spam/security link pre-fetchers do not burn the single-use token.
2. **Implicit Verification:** Users registering via invitation are marked `emailVerified = true` because proving possession of the emailed token verifies inbox ownership.
3. **Strict Email Verification on Accept:** Existing users calling `POST /invitations/accept` must have their authenticated email match `invitation.email` (case-insensitive).
4. **Course Validity:** If a course was soft-deleted between invitation creation and redemption, redemption filters out deleted courses; if no active courses remain, redemption is rejected.

---

## 5. Acceptance Gates (Unlazy Ledger)

```markdown
# Gates: Phase 6.3 Invitations API

OWNS: packages/database/prisma/schema.prisma packages/database/src/** packages/shared/src/** packages/auth/src/** apps/api/src/invitations/** apps/api/src/app.module.ts tasks/todo.md

Scope: Implement Invitations API with single-use tokens, Resend emails, guardian consent, atomic redemption, and enrollments.

- [ ] G1: Database migration applies cleanly to Docker PostgreSQL and Prisma Client is generated
  CHECK: npm run db:generate
  EXPECT: Generated Prisma Client

- [ ] G2: Shared Zod schemas compile and export in @itqan/shared
  CHECK: npm run build -w @itqan/shared
  EXPECT: tsc -p tsconfig.json

- [ ] G3: Monorepo typecheck passes cleanly
  CHECK: npm run typecheck
  EXPECT: @itqan/web@0.1.0 typecheck

- [ ] G4: Invitations integration test suite passes 100% (create, resend, revoke, check, register, accept, expired, reused, revoked, wrong email, and parallel double-redeem race condition)
  CHECK: npx vitest run apps/api/src/invitations/invitations.int.spec.ts
  EXPECT: passed

- [ ] G5: Tenant isolation test suite passes with Invitation and Enrollment models swept
  CHECK: npx vitest run packages/database
  EXPECT: passed
```
