# Acceptance Gates: Step 8.13 — Load Test: 300 Students Start One Quiz Within a Minute (NFR-03, NFR-02)

<!-- unlazy-ledger -->
| Gate | Category | Invariant Checked | Verification Command | Status |
|:---|:---|:---|:---|:---|
| **G1** | Fast Bulk Seeding | Seeds 1 tenant, 1 course, 1 quiz with questions, and 300 students with memberships, active devices, enrollments, and sessions in < 5 seconds (< 1s observed) | `npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "Fast Bulk Seeding"` | [x] |
| **G2** | Concurrency & 0% Error Rate | 300 students start one quiz within 60 seconds with exactly 0.00% error rate (300/300 HTTP 201 Created in ~4.2s) | `npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "300 students start one quiz within 60 seconds"` | [x] |
| **G3** | Latency SLA (NFR-02, NFR-03) | Endpoint latency across all 300 requests satisfies p95 <= 500ms (p95 = 213.6ms, mean = 115.9ms observed) | `npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "300 students start one quiz within 60 seconds"` | [x] |
| **G4** | Snapshot & Device Binding (FR-X05, FR-X10) | Exactly 300 distinct `Attempt` records persisted in DB, each tied to its student's device with frozen snapshot and zero answer leakage | `npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "Database Invariants"` | [x] |
| **G5** | Audit Logging (FR-L01) | Exactly 300 `attempt.start` audit log records created in database | `npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "Database Invariants"` | [x] |
| **G6** | Workspace Regression & Typecheck | Full workspace typecheck and quiz test suites pass with zero errors | `npm run typecheck` | [x] |
<!-- /unlazy-ledger -->

<!-- unlazy-checks -->
G1:
  COMMAND: npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "Fast Bulk Seeding"
  EXPECT: passed

G2:
  COMMAND: npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "300 students start one quiz within 60 seconds"
  EXPECT: passed

G3:
  COMMAND: npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "300 students start one quiz within 60 seconds"
  EXPECT: passed

G4:
  COMMAND: npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "Database Invariants"
  EXPECT: passed

G5:
  COMMAND: npx vitest run apps/api/src/quizzes/quiz-start.load.spec.ts -t "Database Invariants"
  EXPECT: passed

G6:
  COMMAND: npm run typecheck
  EXPECT: (exit: 0)
<!-- /unlazy-checks -->
