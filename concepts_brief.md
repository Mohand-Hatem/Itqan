# Concept Brief: Step 8.7 — Attempt Submission, Auto-Submission & Server-Side Auto-Grading (Synthesized)

## 1. Context & Objectives
In Steps 8.5 and 8.6, we implemented attempt creation (immutable snapshots, option stripping, device binding, hard-clipped deadlines) and autosave with navigation rules (sequential frontier for linear quizzes, technical grace window).

Step 8.7 implements:
1. **Explicit Student Submission**: `POST /attempts/:id/submit` endpoint returning HTTP 200.
2. **Auto-Submission**:
   - Late submit calls ($\text{now} > \text{deadlineAt} + \text{extraTimeSec} + 10\text{s}$) gracefully auto-finalize saved answers (clamping $\text{submittedAt} = \text{deadlineAt} + \text{extraTimeSec}$) with HTTP 200 and `autoSubmitted: true`.
   - Read requests (`GET /attempts/:id`, `GET /attempts/:id/answers`) for expired `in_progress` attempts trigger inline auto-submission.
3. **Pure Server-Side Grading Engine**:
   - Isolated into `apps/api/src/quizzes/grading/attempt-grading.engine.ts` with zero I/O, zero async, zero ORM dependencies.
   - Exact scoring rules for `single`, `true_false`, and `multiple` (exact set match, order-invariant).
   - Drift-free IEEE-754 precision math with standard 2-decimal rounding.
4. **Leak-Proof Response (FR-X05, FR-X08)**:
   - Evaluates `isGradeReleased(quiz, now)`.
   - When grades are hidden, `score`, `maxScore`, `percentage`, `passed` evaluate strictly to `null`.
   - Never returns question-level answer keys or explanations.

---

## 2. Core Architectural Specifications

### A. Pure Grading Engine (`attempt-grading.engine.ts`)
- **`single`**: Exactly 1 option in `selectedOptionIds` matching snapshot option where `isCorrect === true` $\rightarrow$ full question marks; otherwise 0.
- **`true_false`**: Exactly 1 option in `selectedOptionIds` matching snapshot option where `isCorrect === true` $\rightarrow$ full question marks; otherwise 0.
- **`multiple`**: Exact set match:
  $$\text{selectedSet} = \text{Set}(\text{selectedOptionIds})$$
  $$\text{correctSet} = \text{Set}(\text{options where isCorrect === true})$$
  $$\text{isCorrect} \iff (\text{selectedSet.size} = \text{correctSet.size}) \land (\forall id \in \text{correctSet}: id \in \text{selectedSet})$$
  If exact match $\rightarrow$ full question marks; otherwise 0 (no partial marks in MVP).
- **Skipped / Unanswered**: Default to `selectedOptionIds: []`, `isCorrect: false`, `marksAwarded: 0`.
- **Numerical Precision**:
  - `score = Math.round(rawScore * 100) / 100`
  - If `maxScore <= 0`: `score = 0`, `percentage = (passMark === 0 ? 100 : 0)`, `passed = (passMark === 0)`.
  - If `score >= maxScore`: `percentage = 100`, `passed = true`.
  - Otherwise: `percentage = Math.round((score / maxScore) * 10000) / 100`, `passed = (percentage >= quiz.passMark)`.

### B. Atomic Finalization & Concurrency Guard
Inside `this.db.$transaction`:
1. **Atomic CAS Guard**:
   ```typescript
   const updated = await tx.attempt.updateMany({
     where: { id: attemptId, submittedAt: null },
     data: { submittedAt: effectiveSubmittedAt, score: grading.score, passed: grading.passed },
   });
   if (updated.count === 0) {
     // Concurrent submission already won; fetch and return existing attempt state
     return tx.attempt.findUniqueOrThrow({ where: { id: attemptId }, include: { quiz: true } });
   }
   ```
2. **Answer Persistence**:
   - Update existing `AttemptAnswer` rows with `isCorrect` and `marksAwarded`.
   - Batch insert missing snapshot questions using `createMany({ data: missingAnswers, skipDuplicates: true })`.
3. **Audit Logging**:
   - Log `attempt.submit` with metadata `{ quizId, attemptNo, score, passed, isAutoSubmit, isLate }`.

### C. Grade Visibility & Leak Prevention
- `isGradeReleased(quiz, now)`:
  - `on_submit` $\rightarrow$ `true`
  - `on_close` $\rightarrow$ `quiz.closesAt !== null && now >= quiz.closesAt`
  - `all_submitted` / `manual` $\rightarrow$ `false` (evaluated dynamically in 8.10)
- `AttemptSubmitResponseDto`:
  - `id`, `quizId`, `status: "submitted"`, `submittedAt`, `autoSubmitted: boolean`, `gradesReleased: boolean`.
  - If `gradesReleased`: `score`, `maxScore`, `percentage`, `passed`.
  - If `!gradesReleased`: `score: null`, `maxScore: null`, `percentage: null`, `passed: null`.

---

## 3. Implementation Steps & Verification Gates
1. Update `packages/shared/src/schemas/attempts.ts` with `AttemptSubmitResponseSchema`.
2. Create pure grading engine in `apps/api/src/quizzes/grading/attempt-grading.engine.ts` with unit tests in `attempt-grading.engine.spec.ts`.
3. Implement `submitAttempt` and `finalizeAttempt` in `AttemptsService`.
4. Add `@Post("attempts/:id/submit")` in `AttemptsController`.
5. Add integration tests in `attempts.int.spec.ts`.
6. Run unlazy gates and verify all tests pass.

---

## 4. Step 8.8 — Exam Answer-Leak Test Suite (FR-X05, FR-X08, Security §5)

### Threat Vectors & Attack Surface:
1. **Direct Resource Access**:
   - Unauthorized access by students to questions, banks, and quiz configs. All must return `403 Forbidden` (`ROLE_FORBIDDEN`).
2. **Attempt Response Scrubbing**:
   - `AttemptResponseDto` must NEVER contain:
     - `isCorrect` on questions or options
     - `explanation` text
     - `correctOptionIds` / `answerKey`
     - Canaries (secret explanation strings injected at authoring time)
3. **Autosave & Retrieval Sanitization**:
   - `PUT /answers` and `GET /answers` must return purely `{ questionId, selectedOptionIds, savedAt }`.
   - Never reveal `isCorrect`, `marksAwarded`, or validation hint of accuracy.
4. **Submission Scrubbing**:
   - `POST /submit` returns only aggregate scores (or nulls if unreleased), never individual answer grading or explanations.
5. **Curriculum/Tree Scrubbing**:
   - `/courses/:id/tree` and `/content-items/:id/access` must never expose quiz bank references or answers.
6. **Recursive Scanner Invariant**:
   - An adversarial deep traversal over any student response payload guaranteeing zero leak keys or forbidden text values.

---

## 5. Step 8.10 — Grade Release & Review Modes (FR-X07, FR-X08)

### Release Strategies Implemented:
1. **`on_submit`**: Immediate release upon attempt submission.
2. **`on_close`**: Grades unmasked once `quiz.closesAt` has elapsed.
3. **`all_submitted`**: Grades unmasked once all active enrolled students have submitted an attempt, with automatic fallback to `quiz.closesAt` if any student fails to submit before quiz close.
4. **`manual`**: Grades withheld until explicitly released by teacher or assistant via `POST /quizzes/:id/release-grades` (sets `gradesReleasedAt: now()` and logs audit entry).

### Review Modes & Endpoint (`GET /attempts/:id/review`):
1. **`grade`**: Aggregate metrics only (`score`, `maxScore`, `percentage`, `passed`), `questions: null`, zero option correctness flags or explanations.
2. **`grade_answers`**: Questions array with student choices, marks awarded, and correct option flags (`isCorrect: true`), with `explanation: null` strictly stripped.
3. **`full`**: Complete review with student choices, correct option indicators, per-question marks awarded, and full pedagogical `explanation`.
4. **Review Release Timing**: Controlled by `quiz.reviewReleaseAt`; blocks with 403 `REVIEW_NOT_RELEASED` if in the future, unlocking automatically once reached (or falling back to grade release if null).
5. **Staff Privileges**: Teachers and assistants bypass student release locks and can always inspect full reviews with author explanations for any student attempt.

---

## 6. Step 8.12 — Staff Rescue Actions: Extend Time & Device Transfer (FR-X09, FR-X10)

### Staff Rescue Capabilities Implemented:
1. **Time Extension (`POST /attempts/:id/extend` and `POST /attempts/:id/extend-time`)**:
   - Authorized roles: Teachers and assistants only (403 `ROLE_FORBIDDEN` for students).
   - In-progress attempts: Increments `attempt.extraTimeSec`, extending the effective deadline ($\text{deadlineAt} + \text{extraTimeSec}$) and remaining seconds.
   - Reopen capability: Can reopen an attempt that auto-submitted or timed out (`reopen: true`), nullifying `submittedAt`, `score`, and `passed`, and clearing `isCorrect`/`marksAwarded` evaluation on existing answers to prevent leakage.
   - Integrity guard: Reopening is strictly blocked if the quiz review or answers have already been released (`ATTEMPT_CANNOT_REOPEN`).
2. **Device Transfer (`POST /attempts/:id/move-device` and `POST /attempts/:id/transfer-device`)**:
   - Authorized roles: Teachers and assistants only.
   - Validates that the candidate device belongs to the student and is in `active` status (`DEVICE_NOT_FOUND` / `INVALID_DEVICE_STATUS`).
   - Rebinds `attempt.deviceId` to the target device.
   - Fences the old device by deleting old sessions to prevent zombie in-flight writes or ghost submits.
   - The student can immediately resume, autosave, and submit from the new device without `ATTEMPT_DEVICE_MISMATCH`.
3. **Audit Logging**:
   - Every staff rescue intervention writes an append-only audit entry (`attempt.extend_time` and `attempt.move_device`) inside the database transaction, persisting actor user ID, timestamps, delta seconds, and device fingerprints.


