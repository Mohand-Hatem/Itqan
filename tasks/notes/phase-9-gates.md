# Acceptance Gates: Phase 9 Full Track A Audit & Verification

<!-- unlazy-ledger -->
| Gate | Category | Step & Requirement | Verification Command | Status |
|:---|:---|:---|:---|:---|
| **G1** | Notifications Service & Tx Hook | Step 9.1 (FR-N01): In-transaction DB row, post-commit email/push dispatch | `npx vitest run apps/api/src/notifications/notifications.int.spec.ts` | [x] |
| **G2** | SSE Stream & Device Revocation | Step 9.2 (FR-N02): SSE endpoint, 5-stream limit, device revocation control events | `npx vitest run apps/api/src/notifications/sse.int.spec.ts` | [x] |
| **G3** | Dual-Language Emails | Step 9.5: Arabic and English email dispatch for grade release, exam open, device decisions | `npx vitest run apps/api/src/notifications/notifications-email.int.spec.ts` | [x] |
| **G4** | Announcements API | Step 9.6a (FR-N04): Tenant-wide vs course-specific scoping, staff create, student read | `npx vitest run apps/api/src/announcements/announcements.int.spec.ts` | [x] |
| **G5** | Lesson Q&A & Moderation | Step 9.7a (FR-C08): Threaded comments, student Q&A, staff hide & delete enforcement | `npx vitest run apps/api/src/comments/comments.int.spec.ts` | [x] |
| **G6** | General Support Requests | Step 9.8a (FR-N05): Student ticket opening, own-listing scope, staff reply and close | `npx vitest run apps/api/src/support/support-requests-general.int.spec.ts` | [x] |
| **G7** | Analytics Overview (Plain SQL) | Step 9.9a (FR-L02): Single CTE $queryRaw computing 7 platform & course metrics | `npx vitest run apps/api/src/analytics/analytics.int.spec.ts` | [x] |
| **G8** | Audit Log API with Filters | Step 9.10a (FR-A01): Actor, action, and date range filters with keyset cursor pagination | `npx vitest run apps/api/src/audit/audit-logs.int.spec.ts` | [x] |
| **G9** | Tenant Isolation Invariant | Cross-tenant isolation verification across comments, support, notifications, and audit | `npx vitest run packages/database/src/testing/isolation.int.spec.ts -t "Comment"` | [x] |
| **G10** | Monorepo Typecheck | Full workspace typecheck with zero errors across api, web, shared, database, auth | `npm run typecheck` | [x] |
<!-- /unlazy-ledger -->

<!-- unlazy-checks -->
G1:
  COMMAND: npx vitest run apps/api/src/notifications/notifications.int.spec.ts
  EXPECT: passed

G2:
  COMMAND: npx vitest run apps/api/src/notifications/sse.int.spec.ts
  EXPECT: passed

G3:
  COMMAND: npx vitest run apps/api/src/notifications/notifications-email.int.spec.ts
  EXPECT: passed

G4:
  COMMAND: npx vitest run apps/api/src/announcements/announcements.int.spec.ts
  EXPECT: passed

G5:
  COMMAND: npx vitest run apps/api/src/comments/comments.int.spec.ts
  EXPECT: passed

G6:
  COMMAND: npx vitest run apps/api/src/support/support-requests-general.int.spec.ts
  EXPECT: passed

G7:
  COMMAND: npx vitest run apps/api/src/analytics/analytics.int.spec.ts
  EXPECT: passed

G8:
  COMMAND: npx vitest run apps/api/src/audit/audit-logs.int.spec.ts
  EXPECT: passed

G9:
  COMMAND: npx vitest run packages/database/src/testing/isolation.int.spec.ts -t "Comment"
  EXPECT: passed

G10:
  COMMAND: npm run typecheck
  EXPECT: (exit: 0)
<!-- /unlazy-checks -->
