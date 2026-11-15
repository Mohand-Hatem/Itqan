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

---

## 7. Step 9.1 — Notifications Table, Service & Transactional Post-Commit Dispatch (FR-N01, ADR-006)

### 1. Context & Objectives
ADR-006 defines the database `notifications` table as the durable source of truth for platform notifications. External channels (SSE for open tabs, FCM push for closed devices, and Resend for transactional email) are delivery mechanisms that react to this source of truth.

Step 9.1 establishes:
1. **Durable Schema**: The `notifications` model in PostgreSQL, scoped to `tenant_id` and indexed by `(tenant_id, user_id, read_at)` and `(tenant_id, user_id, created_at desc)`.
2. **Transactional Service**: Writing notification records directly inside existing caller transactions via `NotificationsService.create(data, tx)`.
3. **Post-Commit Dispatch Invariant**: Side effects (email and push) execute strictly after the database transaction commits. If the transaction aborts or encounters an error, zero dispatches are sent.
4. **Read Status & Feed Endpoints**: `GET /notifications` (with unread count and pagination) and `PATCH /notifications/read` (bulk or selective read marking).

---

### 2. Core Architectural Specifications

#### A. Database Schema (`notifications`)
- `id`: UUIDv7 primary key (`@default(uuid(7)) @db.Uuid`).
- `tenantId`: Foreign key to `tenants` with cascade delete.
- `userId`: Foreign key to `users` with cascade delete.
- `type`: String identifying notification classification (`announcement`, `grade_released`, `device_request_decided`, `course_access`, `exam_opening`, etc.).
- `title`: Short human-readable title.
- `body`: Notification content body.
- `data`: JSON payload (`Json @default("{}")`) storing contextual entity IDs (e.g., `courseId`, `quizId`, `attemptId`, `requestId`).
- `readAt`: Nullable timestamp (`DateTime? @db.Timestamptz`). Null indicates unread.
- `createdAt`: Timestamp with timezone (`DateTime @default(now()) @db.Timestamptz`).
- **Indexes**:
  - `@@index([tenantId, userId, readAt])` for fast unread count aggregation (`count where readAt is null`).
  - `@@index([tenantId, userId, createdAt(sort: Desc)])` for descending feed queries.

#### B. Transactional Coordination & Post-Commit Hook
When a domain service (such as attempt grading, enrollment, or support request approval) generates a notification, it writes the notification row inside its own `$transaction`:
```typescript
await this.notificationsService.withTransaction(async (tx, postCommit) => {
  // 1. Core domain writes inside tx
  // 2. Notification row inserted inside tx
  const notification = await this.notificationsService.create({
    userId,
    type,
    title,
    body,
    data,
  }, tx);

  // 3. Register side-effect callback
  postCommit(async () => {
    await this.mailer.send(...);
    await this.sse.broadcast(...);
  });
});
```
- **Rollback Behavior**: If the callback inside `withTransaction` throws, Prisma rolls back the entire database transaction. The registered `postCommit` functions are discarded and never called.
- **Commit Behavior**: Only after the transaction returns successfully, the registered callbacks run sequentially or concurrently. Failures in external delivery handlers (e.g. temporary SMTP timeout) are caught and logged without reversing committed business state.

#### C. Querying & Mark-as-Read Contracts
- **`GET /notifications`**:
  - Accessible to any authenticated user in the current tenant.
  - Query parameters: `unreadOnly` (boolean), `limit` (1..100, default 20), `cursor` (UUID for keyset pagination).
  - Response: `{ items: NotificationItemDto[], unreadCount: number, nextCursor: string | null }`.
- **`PATCH /notifications/read`**:
  - Request body: `{ ids?: string[] }`.
  - If `ids` is provided and non-empty: updates `read_at = now()` for notifications where `id in ids`, `userId = currentUser.id`, `tenantId = currentTenant.id`, and `readAt is null`.
  - If `ids` is empty or omitted: marks all unread notifications for the current user in this tenant as read (`read_at = now()`).
  - Response: `{ updatedCount: number }`.

---

### 3. Stress-Testing & Edge Cases
1. **Cross-Tenant Leakage**:
   - A user in Tenant A must never be able to view, query, or mark as read any notification belonging to Tenant B, even if they guess valid UUIDs. Handled by the tenant-scoped Prisma extension and explicit user ID binding.
2. **Ghost Dispatches**:
   - If an exam auto-submission or payment recording fails a database constraint after triggering a notification callback, the email or SSE must not dispatch.
3. **High Volume Unread Count**:
   - Unread count queries must run as a fast index scan using `(tenant_id, user_id, read_at)` without scanning full notification tables.
4. **Idempotent Mark-as-Read**:
   - Calling `PATCH /notifications/read` repeatedly on already-read notifications safely updates zero rows and returns `updatedCount: 0` without error.

---

## 8. Step 9.2 — Server-Sent Events (SSE) Stream, In-Memory Connection Map & Control Events (FR-N02, ADR-006)

### 1. Context & Objectives
ADR-006 specifies Server-Sent Events (SSE) as the one-way real-time channel to open browser tabs without external messaging brokers or Redis pub/sub.

Step 9.2 implements:
1. **In-Memory Connection Registry**: `SseService` tracking active connection streams keyed by `userId` in memory (`Map<userId, SseConnection[]>`).
2. **Concurrency Cap (5 Streams per User)**: Enforces a hard limit of 5 simultaneous SSE connections per user account. When an authenticated client requests a 6th stream, the oldest connection for that user is terminated with a clean stream close.
3. **Control Event Broadcasting**:
   - `device_revoked`: Emitted immediately when a device is revoked by staff or system, signaling the affected browser client to invalidate local tokens or redirect to blocked status.
   - `notification.created`: Pushes newly persisted notifications to active tabs so the bell badge increments in real time without polling.
4. **HTTP SSE Endpoint (`GET /api/sse` & `GET /api/notifications/stream`)**:
   - Formatted with headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
   - Sends periodic keep-alive comments (`: ping\n\n`) to prevent intermediate proxies or Cloudflare from terminating idle sockets.
   - Binds to Express response lifecycle (`res.on("close")`, `res.on("finish")`) ensuring complete cleanup of references to prevent memory leaks.

---

### 2. Core Architectural Specifications

#### A. Connection Model & Storage
Each connected client is tracked in an internal record:
```typescript
interface SseConnection {
  id: string; // Connection UUID
  userId: string;
  tenantId: string;
  deviceId?: string | null;
  res: Response;
  connectedAt: Date;
}
```
- `connectionsByUser: Map<string, SseConnection[]>`:
  - Adding a connection: If `connections.length >= 5`, shift the oldest connection, write `event: stream_closed\ndata: {"reason":"LIMIT_EXCEEDED"}\n\n`, and call `oldest.res.end()`.
  - Disconnect handling: Listens for socket `close` events, removing the connection from the user's array. If the user's array becomes empty, deletes the key from the map.

#### B. Event Wire Format (RFC 8895 SSE Standard)
Events follow standard text/event-stream formatting:
```text
event: <eventType>
data: <jsonPayload>

```
- Control events:
  - `device_revoked`: Payload `{ deviceId: string, timestamp: string }`.
  - `session_terminated`: Payload `{ userId: string, reason: string }`.
  - `notification.created`: Payload contains full `NotificationItemDto`.
- Keepalive ping:
  - Formatted as an SSE comment `: ping\n\n` every 25 seconds.

#### C. Control Event Integration
When `StudentsAccessService.revokeDevice(deviceId, actorUserId)` executes:
1. Revocation is committed in the database transaction.
2. In the post-commit phase, `this.sseService.emitToUser(device.userId, { event: "device_revoked", data: { deviceId } })` is triggered.
3. The connected client receives the message in real time and can trigger UI lockouts or logouts.

---

### 3. Stress-Testing & Failure Modes
1. **Socket Dropping / Client Abort**:
   - A client abruptly navigating away or losing network connectivity must not throw unhandled stream write errors (`ERR_STREAM_DESTROYED` / `EPIPE`). The service catches socket write errors and purges dead sockets immediately.
2. **Connection Leak on Crash / Hang**:
   - Sockets that hang without traffic are kept alive with lightweight periodic ping comments and cleared when the OS reports TCP disconnection.
3. **Memory Ceiling**:
   - With 1,000 active students capped at 5 streams, max active descriptors = 5,000. Express Response objects consume minimal memory when idle without buffered writes.
4. **Cross-Tenant Event Fencing**:
   - Broadcasted events check `conn.tenantId === targetTenantId` to guarantee that multi-tenant events never bleed into streams open on a different tenant domain.

---

## 9. Step 9.5 — Multilingual Email Notifications for Important Types (FR-N03, ADR-006)

### 1. Context & Objectives
FR-N03 requires that important platform notifications be dispatched not only in-app (table + SSE) but also via email through Resend:
- `activation` (Account email verification, Step 4.4)
- `password_reset` (Password reset link, Step 4.4)
- `grade_released` (Quiz grades published or unmasked)
- `exam_opening` (Quiz availability window opened)
- `course_access` (Student granted enrollment in a course)
- `device_request_decided` (Staff approved or rejected a device change or sign-out request)

Step 9.5 builds:
1. **Bilingual Email Templates**: Pure rendering functions for each important notification type supporting Arabic (`ar`, default RTL) and English (`en`, LTR).
2. **Resend Dispatch Handlers**: Strongly-typed dispatch helpers in `packages/auth/src/email/` capturing recipients, localized subjects, plaintext alternatives, and HTML layouts.
3. **Fault-Tolerant Delivery Pipeline**: Integrated into `NotificationsService` post-commit hooks so email dispatch failures (e.g. rate limits, network timeouts, invalid API keys) never abort or roll back committed database state.

---

### 2. Core Architectural Specifications

#### A. Template Taxonomy & Localized Rendering (`packages/auth/src/email/templates.ts`)
- **`grade_released`**:
  - Parameters: `{ studentName?: string; quizTitle: string; courseTitle?: string; score?: number; maxScore?: number; percentage?: number; passed?: boolean; reviewUrl?: string; tenantName: string; locale?: EmailLocale }`.
  - Content: Informs student that grades are released with score breakdown, pass/fail status, and direct link to review attempt.
- **`exam_opening`**:
  - Parameters: `{ studentName?: string; quizTitle: string; courseTitle?: string; opensAt?: Date | string; closesAt?: Date | string; durationMin?: number; examUrl?: string; tenantName: string; locale?: EmailLocale }`.
  - Content: Informs student that an exam is now open, stating duration, closing deadline, and exam start URL.
- **`course_access`**:
  - Parameters: `{ studentName?: string; courseTitle: string; courseUrl?: string; tenantName: string; locale?: EmailLocale }`.
  - Content: Confirms enrollment into a new course with a direct access button.
- **`device_request_decided`**:
  - Parameters: `{ studentName?: string; status: "approved" | "rejected"; requestType: "device_change" | "sign_out_other"; tenantName: string; loginUrl?: string; locale?: EmailLocale }`.
  - Content: Communicates decision on device change or sign-out requests with next steps for logging in.

#### B. Dispatch Helpers (`packages/auth/src/email/client.ts`)
Each template has a corresponding asynchronous helper:
- `sendGradeReleasedEmail(options)`
- `sendExamOpeningEmail(options)`
- `sendCourseAccessEmail(options)`
- `sendDeviceRequestDecidedEmail(options)`
In test mode (`NODE_ENV === "test"`), records are written to `testMailbox` for assertion without live external calls.

#### C. Post-Commit Asynchronous Pipeline
Email sending is inherently an out-of-band side effect:
1. The domain operation inserts the `notifications` row within `this.db.$transaction`.
2. Inside `withTransaction`, the caller registers a `postCommit` callback.
3. When the database transaction commits, the post-commit handler triggers the email dispatch.
4. If Resend returns an error or network drops, the error is caught and logged as a warning; the database transaction remains intact.

---

### 3. Stress-Testing & Failure Modes
1. **Resend API Down / Quota Reached**:
   - Outages or quota rejections must never cause 500 errors to end users completing exams or requesting devices. Handled via try/catch inside post-commit callbacks.
2. **Missing Recipient Email or Name**:
   - Templates provide sensible defaults (e.g. "مستخدم إتقان" / "Itqan Student") when `studentName` is omitted.
3. **HTML Injection in User-Supplied Titles**:
   - Course titles, quiz titles, and student names are escaped before embedding in HTML templates to prevent stored cross-site scripting (XSS) in email clients.
4. **Locale Fallback**:
   - If tenant or user locale is missing or unsupported, system defaults safely to Arabic (`ar`) per platform requirement NFR-04.

---

## 10. Step 9.6a — Announcements API, Tenant-Wide or per Course (FR-N04)

### 1. Context & Objectives
FR-N04 specifies: *Staff publish announcements to the whole tenant or one course.*
In accordance with `docs/04-database.md` and `docs/07-api.md`:
1. **Announcements Schema**:
   - Table `announcements` scoped to `tenant_id` (`T`).
   - Supports tenant-wide broadcast (`course_id = null`) or course-specific updates (`course_id = uuid`).
2. **Role-Based Access Control**:
   - Staff (`teacher`, `assistant`): Create announcements, list all announcements with optional `?courseId=` filter, update/delete if needed.
   - Student (`student`): Can read tenant-wide announcements + announcements for courses where the student has an `active` enrollment. Unenrolled courses' announcements are strictly inaccessible (403 or filtered out).
3. **Notification Fanout on Publish**:
   - Publishing an announcement creates in-app notification rows (`type: "announcement"`) for all target recipients inside the database transaction:
     - Tenant-wide: for all active students in the tenant.
     - Course-specific: for all students actively enrolled in the specified course.
   - Dispatches `notification.created` SSE events post-commit so active browser tabs update their badges without polling.
4. **Audit Logging**:
   - Publishing an announcement records an insert-only audit log entry (`announcement.create`) with actor, target, and metadata.

---

### 2. Core Architectural Specifications

#### A. Database Schema (`packages/database/prisma/schema.prisma`)
```prisma
model Announcement {
  id          String    @id @default(uuid(7)) @db.Uuid
  tenantId    String    @map("tenant_id") @db.Uuid
  courseId    String?   @map("course_id") @db.Uuid
  title       String
  body        String
  publishedAt DateTime  @default(now()) @map("published_at") @db.Timestamptz
  createdBy   String    @map("created_by") @db.Uuid
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  tenant      Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  course      Course?   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  author      User      @relation("AnnouncementCreatedBy", fields: [createdBy], references: [id], onDelete: Cascade)

  @@index([tenantId, publishedAt(sort: Desc)])
  @@index([tenantId, courseId, publishedAt(sort: Desc)])
  @@map("announcements")
}
```
- Registered in `packages/database/src/tenancy/tenant-models.ts` (`TENANT_MODELS`).
- Registered in `packages/database/src/testing/tenant-isolation.ts` (`TENANT_FIXTURES`).
- Migration generated and applied to Docker PostgreSQL.

#### B. API Contracts & Shared DTOs (`packages/shared/src/schemas/announcements.ts`)
1. **`POST /api/announcements`**:
   - Guards: `AuthGuard`, `RolesGuard(["teacher", "assistant"])`.
   - Body:
     - `title`: `z.string().min(1).max(255)`
     - `body`: `z.string().min(1)`
     - `courseId`: `z.string().uuid().optional()` (if omitted or null, tenant-wide)
   - Behavior:
     - Validates that `courseId` (if provided) exists in the current tenant and is not deleted.
     - Inserts the `Announcement` row inside `$transaction`.
     - Identifies target student user IDs (all tenant students if tenant-wide; students with `active` enrollment in `courseId` if course-specific).
     - Inserts `Notification` rows (`type: "announcement"`) via `createMany` inside the same transaction.
     - Registers a post-commit callback to emit `notification.created` SSE events to active student connections.
     - Writes `auditLog.record(...)`.
   - Response: `201 Created` with `AnnouncementDto`.
2. **`GET /api/announcements`**:
   - Guards: `AuthGuard`.
   - Query:
     - `courseId`: `z.string().uuid().optional()`
     - `limit`: `z.coerce.number().min(1).max(100).default(20)`
     - `cursor`: `z.string().uuid().optional()`
   - Filtering Rules:
     - If actor is Staff (`teacher`, `assistant`):
       - If `courseId` specified: returns announcements for that course.
       - If `courseId` omitted: returns all tenant announcements (both tenant-wide and course-specific).
     - If actor is Student:
       - If `courseId` specified:
         - Checks if student has `active` enrollment in `courseId`. If not, returns `403 Forbidden`.
         - Returns announcements for that course.
       - If `courseId` omitted:
         - Fetches active course IDs for this student: `where: { courseId: { in: activeCourseIds } OR { courseId: null } }`.
         - Only returns tenant-wide announcements + announcements for enrolled courses.
   - Keyset cursor pagination ordered by `publishedAt DESC, id DESC`.
   - Response: `200 OK` `{ items: AnnouncementDto[], nextCursor: string | null }`.

---

### 3. Stress-Testing & Failure Modes
1. **Unenrolled Course Announcement Leakage**:
   - A student must never be able to view course announcements for courses they have not enrolled in, nor should they receive in-app notifications or SSE for those announcements.
2. **Cross-Tenant Isolation**:
   - Staff in Tenant A cannot create announcements in Tenant B or target courses belonging to Tenant B.
   - Students in Tenant A never receive announcements from Tenant B.
3. **High Fanout Performance**:
   - For tenant-wide or large-course announcements (e.g. hundreds or thousands of students), notifications are batch inserted using `createMany` rather than single-row sequential queries.
4. **Deleted Course Boundary**:
   - If a course is soft-deleted, staff cannot publish new announcements to it, and students cannot access it.

---

### 4. Verification & Acceptance Gates (Step 9.6a)
- **G1 (Schema & Tenant Enforcement)**: `Announcement` is registered in `TENANT_MODELS`, migration applied, and tenant isolation tests verify cross-tenant boundaries.
- **G2 (Publish & Fanout)**: Staff publishing tenant-wide and course announcements successfully writes announcement rows, writes in-app notifications for enrolled students, and audits the action.
- **G3 (Student Course Access Fencing)**: Students receive only tenant-wide announcements and announcements for courses they are enrolled in; querying unenrolled course announcements returns 403 Forbidden.
- **G4 (Keyset Pagination)**: Keyset cursor pagination over `publishedAt` works accurately for feeds with >20 items.
- **G5 (Workspace Typecheck & Regressions)**: `npm run typecheck` passes cleanly with zero errors across the entire monorepo.






---

## 11. Step 9.7a — Lesson Q&A API with Staff Moderation (Hide & Delete) (FR-C08)

### 1. Context & Objectives
FR-C08 specifies: *Lesson Q&A: students post, staff reply, staff can hide or delete posts.*
Per `docs/04-database.md` and `docs/07-api.md`:
1. **Schema (`comments`)**:
   - Table `comments` scoped to `tenant_id` (`T`).
   - Links each comment to a `content_item_id` (a lecture/lesson or video), an `author_membership_id`, and an optional `parent_id` (to support replies/threads).
   - Supports `hidden_at` (moderation hide) and `deleted_at` (soft delete).
2. **Access & Enrollment Gate**:
   - A student can post or read comments on a content item only if they hold an `active` enrollment in the course that contains the content item.
   - Staff (`teacher`, `assistant`) have full access across all content items in the tenant.
3. **Visibility & Moderation Rules**:
   - **Students**: Soft-deleted comments (`deletedAt !== null`) and hidden comments (`hiddenAt !== null`) are completely filtered out and invisible.
   - **Staff**: Can view hidden comments (with `hiddenAt` visible so staff can review or unhide), but soft-deleted comments are excluded.
   - **Author Edit**: The author can edit their own comment body (`PATCH /api/comments/:id`).
   - **Staff Moderation**: Staff can hide or unhide a comment (`PATCH /api/comments/:id` with `{ hidden: boolean }`), recording an audit log entry (`comment.hide` / `comment.unhide`).
   - **Deletion**: The author or staff can delete a comment (`DELETE /api/comments/:id`), setting `deleted_at = now()`.

---

### 2. Core Architectural Specifications

#### A. Database Model (`packages/database/prisma/schema.prisma`)
```prisma
model Comment {
  id                 String    @id @default(uuid(7)) @db.Uuid
  tenantId           String    @map("tenant_id") @db.Uuid
  contentItemId      String    @map("content_item_id") @db.Uuid
  authorMembershipId String    @map("author_membership_id") @db.Uuid
  parentId           String?   @map("parent_id") @db.Uuid
  body               String
  hiddenAt           DateTime? @map("hidden_at") @db.Timestamptz
  deletedAt          DateTime? @map("deleted_at") @db.Timestamptz
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt          DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  tenant       Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  contentItem  ContentItem @relation(fields: [contentItemId], references: [id], onDelete: Cascade)
  author       Membership  @relation(fields: [authorMembershipId], references: [id], onDelete: Cascade)
  parent       Comment?    @relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies      Comment[]   @relation("CommentReplies")

  @@index([tenantId, contentItemId, createdAt])
  @@index([tenantId, parentId])
  @@map("comments")
}
```
- Registered in `TENANT_MODELS` and `TENANT_FIXTURES`.

#### B. API Endpoints (`apps/api/src/comments/`)
1. **`POST /api/content-items/:id/comments`**:
   - Body: `{ body: string, parentId?: string }`.
   - Validates that content item exists and student is enrolled in the item's course.
   - If `parentId` supplied, verifies parent comment exists in the same content item and is not deleted.
   - Returns created comment DTO with author details (`authorName`, `authorRole`).
2. **`GET /api/content-items/:id/comments`**:
   - Query: `cursor?: string`, `limit?: number`.
   - Students see only active, unhidden comments (`hiddenAt: null, deletedAt: null`).
   - Staff see all un-deleted comments, including those with `hiddenAt !== null`.
3. **`PATCH /api/comments/:id`**:
   - Body: `{ body?: string, hidden?: boolean }`.
   - Author can update `body`. Students cannot set `hidden` (403 Forbidden).
   - Staff can update `hidden` (audit logged: `comment.hide` or `comment.unhide`).
4. **`DELETE /api/comments/:id`**:
   - Accessible to comment author and staff (`teacher`, `assistant`).
   - Sets `deletedAt = now()`.

---

### 3. Acceptance Gates (Step 9.7a)
- **G1 (Schema & Tenant Isolation)**: `Comment` registered in `TENANT_MODELS` and `TENANT_FIXTURES`, migration applied, and tenant isolation tests pass.
- **G2 (Post & Reply)**: Students and staff can post top-level comments and replies under content items; replies reference valid parents.
- **G3 (Enrollment Fencing)**: Students without active enrollment in the course receive 403 on both GET and POST comments.
- **G4 (Moderation & Invisibility)**: Staff hiding a comment makes it completely invisible to students; staff deleting a comment soft-deletes it; students cannot hide or edit others' comments.
- **G5 (Workspace Regression & Typecheck)**: `npm run typecheck` passes with zero errors.

---

## 12. Step 9.8a — General Support Requests API (FR-N05)

### 1. Context & Objectives
FR-N05 specifies: *Support requests have types: device change, sign-out other device, general.*
In Step 5.8a, device change and sign-out requests were implemented for unblocking students encountering device caps.
Step 9.8a completes FR-N05 by adding:
1. **Student Support Request Submission**: Students create general inquiries/tickets (`POST /api/support-requests`).
2. **Student Self-Service Listing**: Students view their own submitted tickets and current status (`GET /api/support-requests`).
3. **Staff Resolution & Answering**: Staff answer and close tickets with an optional response message (`POST /api/support-requests/:id/close`), setting `status = "closed"`, saving the reply, and auditing the resolution.
4. **In-App Notification**: When staff answers/closes a request, an in-app notification is dispatched to the student.

---

### 2. Core Architectural Specifications

#### A. Database Schema
Extend `SupportRequest` with an optional `response` field:
```prisma
model SupportRequest {
  id              String               @id @default(uuid(7)) @db.Uuid
  tenantId        String               @map("tenant_id") @db.Uuid
  membershipId    String               @map("membership_id") @db.Uuid
  type            SupportRequestType
  status          SupportRequestStatus @default(open)
  message         String?
  response        String?
  pendingDeviceId String?              @map("pending_device_id") @db.Uuid
  decidedById     String?              @map("decided_by") @db.Uuid
  decidedAt       DateTime?            @map("decided_at") @db.Timestamptz
  createdAt       DateTime             @default(now()) @map("created_at") @db.Timestamptz
  updatedAt       DateTime             @updatedAt @map("updated_at") @db.Timestamptz

  tenant        Tenant     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  membership    Membership @relation(fields: [membershipId], references: [id], onDelete: Cascade)
  pendingDevice Device?    @relation(fields: [pendingDeviceId], references: [id], onDelete: SetNull)
  decidedBy     User?      @relation("SupportRequestDecidedBy", fields: [decidedById], references: [id], onDelete: SetNull)

  @@index([tenantId, status, createdAt(sort: Desc)])
  @@index([membershipId, type, status])
  @@map("support_requests")
}
```

#### B. API Endpoints
1. **`POST /api/support-requests`**:
   - Allowed: `student`.
   - Body: `{ message: string }` (5 to 5000 characters).
   - Creates a new `SupportRequest` with `type = "general"`, `status = "open"`, `tenantId`, `membershipId`.
   - Records audit log: `support_request.create`.
   - Returns HTTP 201 `{ id, type: "general", status: "open", message, createdAt }`.
2. **`GET /api/support-requests`**:
   - Allowed: `student`, `teacher`, `assistant`.
   - If caller is `student`:
     - Filters queries strictly to caller's `membershipId`.
     - Returns `{ items: [{ id, type, status, message, response, createdAt, decidedAt }], nextCursor }`.
   - If caller is `teacher` or `assistant`:
     - Existing tenant-wide listing with student profile and pending device details.
3. **`POST /api/support-requests/:id/close`**:
   - Allowed: `teacher`, `assistant`.
   - Body: `{ response?: string }`.
   - Verifies request is open and belongs to current tenant.
   - Atomically updates: `status = "closed"`, `response`, `decidedById = staff.userId`, `decidedAt = now()`.
   - Dispatches in-app notification to the student: `type: "support_request_decided"`.
   - Records audit log: `support_request.close`.
   - Returns HTTP 200 `{ id, status: "closed", response, decidedAt }`.

---

### 3. Acceptance Gates (Step 9.8a)
- **G1 (Schema & Tenant Isolation)**: `response` column added to `support_requests`, migration applied, and tenant isolation tests pass.
- **G2 (Student Creation & Validation)**: Students can create general support requests with validated message; empty/invalid messages rejected with 400.
- **G3 (Student Own Listing & Data Scrubbing)**: Students listing support requests see only their own requests; staff see all tenant requests.
- **G4 (Staff Resolution & Notification)**: Staff can answer and close general support requests with response text, recording audit log and dispatching in-app notification.
- **G5 (Workspace Regression & Typecheck)**: `npm run typecheck` passes with zero errors across all workspaces.

---

## 13. Step 9.9a — Analytics Overview API with Plain SQL (FR-L02)

### 1. Context & Objectives
FR-L02 specifies: *Dashboard numbers: students, active students (7 days), courses, published items, quiz participation, average grades, pending requests.*
Per `docs/07-api.md:106`, staff access `GET /api/analytics/overview`.
Per step definition in `tasks/todo.md`:
*Analytics overview API with plain SQL (FR-L02). Done when: numbers match seeded data in a test.*

Key requirements:
1. **Plain SQL Aggregations (`$queryRaw`)**:
   Instead of pulling relational tables into memory, calculate all metrics inside PostgreSQL via optimized aggregate queries filtered on `tenant_id`:
   - `students`: Count of active student memberships (`role = 'student' AND status = 'active'`).
   - `activeStudents7d`: Distinct active students who had activity in the last 7 days (session update, lesson progress update, or quiz attempt).
   - `courses`: Count of non-deleted courses (`deleted_at IS NULL`).
   - `publishedItems`: Count of non-deleted, published content items (`deleted_at IS NULL AND is_published = true`).
   - `quizParticipation`: Count of quiz attempts in the tenant (`attempts`).
   - `averageGrade`: Average percentage across submitted quiz attempts (`score / max_score * 100`, rounded to 2 decimals), or `null` if no submitted attempts.
   - `pendingRequests`: Count of open support requests (`status = 'open'`).
2. **Access Control**:
   - Accessible by staff (`teacher`, `assistant`).
   - Blocked for students (`403 Forbidden` / `ROLE_FORBIDDEN`).
3. **Tenant Boundary**:
   - Queries strictly filter by `tenant_id = context.tenantId`. Metrics never leak cross-tenant numbers.

---

### 2. Core Architectural Specifications

#### A. Shared Schema (`packages/shared/src/schemas/analytics.ts`)
```typescript
import { z } from "zod";

export const AnalyticsOverviewResponseSchema = z.object({
  students: z.number().int().nonnegative(),
  activeStudents7d: z.number().int().nonnegative(),
  courses: z.number().int().nonnegative(),
  publishedItems: z.number().int().nonnegative(),
  quizParticipation: z.number().int().nonnegative(),
  averageGrade: z.number().nullable(),
  pendingRequests: z.number().int().nonnegative(),
});

export type AnalyticsOverviewResponseDto = z.infer<typeof AnalyticsOverviewResponseSchema>;
```

#### B. Service & Controller (`apps/api/src/analytics/`)
- `AnalyticsService`:
  Executes high-performance plain SQL aggregation queries using `this.db.$queryRaw`.
- `AnalyticsController`:
  `GET /api/analytics/overview`, guarded by `@Roles("teacher", "assistant")`.
- `AnalyticsModule`:
  Registered in `AppModule`.

---

### 3. Acceptance Gates (Step 9.9a)
- **G1 (Aggregation Accuracy & Seed Match)**: Analytics numbers match exact seeded database records across all 7 metrics.
- **G2 (Active Students 7-Day Window)**: `activeStudents7d` accurately counts students active within the past 7 days and excludes students whose last activity was >7 days ago.
- **G3 (Grade Precision & Null Fallback)**: `averageGrade` computes exact 2-decimal percentage, handles 0 attempts with `null`, and ignores unsubmitted/in-progress attempts.
- **G4 (Access Control & Tenant Isolation)**: Students receive 403 Forbidden; staff on Tenant A see only Tenant A analytics (never Tenant B data).
- **G5 (Workspace Regression & Typecheck)**: `npm run typecheck` passes with zero errors across all workspaces.

---

## 14. Step 9.10a — Audit Log API with Filters (FR-A01, Step 9.10a)

### 1. Context & Objectives
Per `docs/07-api.md:105`:
`| GET | /audit-logs | T, SA | Filter by actor, action, date |`
And in `tasks/todo.md`:
*Audit log API with filters. Done when: a test filters by actor, action and date.*

Key requirements:
1. **Filtering by Actor, Action, Date & Cursor**:
   - `actorUserId`: filter by specific actor user UUID.
   - `action`: exact action verb (e.g. `support_request.create`, `comment.hide`, `attempt.submit`).
   - `from`: start timestamp (`createdAt >= from`).
   - `to`: end timestamp (`createdAt <= to`).
   - Keyset cursor pagination (`cursor: UUID`, `limit: number` 1–100, default 50).
2. **Access Control**:
   - Allowed: Teacher (`teacher`) and Super Admin (`isSuperAdmin: true`).
   - Blocked: Assistants (`403 Forbidden` / `ROLE_FORBIDDEN`) and Students (`403 Forbidden`).
3. **Data Scrubbing & Redaction**:
   - Audit logs are insert-only and immutably protected by DB triggers.
   - Queries strictly filter by `tenantId = context.tenantId` for tenant requests (or null for platform).
   - Returns actor details (`id`, `name`, `email`).

---

### 2. Core Architectural Specifications

#### A. Shared Schema (`packages/shared/src/schemas/audit.ts`)
```typescript
import { z } from "zod";

export const AuditLogListQuerySchema = z.object({
  actorUserId: z.string().uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditLogListQueryDto = z.infer<typeof AuditLogListQuerySchema>;

export const AuditLogItemSchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.coerce.date(),
  actor: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string(),
    })
    .nullable(),
});

export type AuditLogItemDto = z.infer<typeof AuditLogItemSchema>;

export const AuditLogListResponseSchema = z.object({
  items: z.array(AuditLogItemSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type AuditLogListResponseDto = z.infer<typeof AuditLogListResponseSchema>;
```

#### B. Service & Controller (`apps/api/src/audit/`)
- Update `AuditService.list(query: AuditLogListQueryDto)`:
  Filters by `actorUserId`, `action`, `from`, `to`, `cursor`, with ordering `[{ createdAt: "desc" }, { id: "desc" }]` and takes `limit + 1`.
- Add `AuditController`:
  `GET /api/audit-logs`, guarded with `@Roles("teacher")`.
- Wire `AuditController` in `AuditModule`.

---

### 3. Acceptance Gates (Step 9.10a)
- **G1 (Actor Filter)**: Querying with `actorUserId` returns only log entries performed by that actor.
- **G2 (Action Filter)**: Querying with `action` returns only log entries matching the specified action verb.
- **G3 (Date Range Filter)**: Querying with `from` and `to` bounds accurately filters entries inside the date window.
- **G4 (Access Control & Keyset Pagination)**: Teachers can list with cursor pagination; assistants and students receive 403 Forbidden; cross-tenant logs are never leaked.
- **G5 (Workspace Regression & Typecheck)**: `npm run typecheck` passes with zero errors across all workspaces.


---

# Section §15: Step 10.1 — Scheduled Background Jobs (Cleanup, Grade Release, Pending Uploads, 30-Day Tenant Purge)

## 1. Context & Objectives
Per `docs/03-system-design.md §6`, `docs/02-srs.md` (FR-T04, FR-X07, FR-N01), and `tasks/todo.md`:
Background maintenance tasks run on schedules to prevent state rot, enforce time-based domain transitions, clean up abandoned storage, and permanently destroy soft-deleted tenant data after the 30-day grace period.

Step 10.1 builds:
1. **Cleanup Job (`cleanupExpiredEntities`)**:
   - Deletes expired invitations (`expiresAt < now`).
   - Deletes expired sessions (`expiresAt < now`).
   - Deletes expired verifications (`expiresAt < now`).
2. **Grade Release & Auto-Submission Job (`releaseQuizGrades`)**:
   - Queries quizzes with `gradesReleasedAt === null` and `deletedAt === null` where `closesAt <= now` and `gradeRelease` is `on_close` or `all_submitted`.
   - Auto-submits any remaining `in_progress` attempts whose deadline has passed (`deadlineAt < now` or quiz closed) using `evaluateAttemptGrading`.
   - Sets `gradesReleasedAt = now` on the quiz.
   - Dispatches in-app notifications (`type: "grade_released"`) and emails to students who took the quiz.
3. **Pending Uploads Cleanup Job (`cleanupPendingUploads`)**:
   - Deletes abandoned `MediaAsset` records with `status === "pending"` created $> 24$ hours ago.
   - Cleans up associated R2 objects if they were uploaded.
4. **30-Day Tenant Purge Job (`purgeSoftDeletedTenants`)**:
   - Finds tenants where `status === "deleted"` and `deletedAt <= now - 30 days`.
   - Cleans up all R2 storage keys associated with the tenant.
   - Deletes the tenant database row (`prisma.tenant.delete`), triggering PostgreSQL `ON DELETE CASCADE` across all child tables.
5. **Idempotency Invariant**:
   - Running any job twice with the same system state produces the exact same result without errors, duplicated records, or re-dispatched notifications.

---

## 2. Core Architectural Specifications

### A. Dependencies & Wiring
- Add `@nestjs/schedule` to `apps/api/package.json`.
- Create `apps/api/src/jobs/`:
  - `jobs.module.ts`: Imports `ScheduleModule.forRoot()`, exports `JobsService`.
  - `jobs.service.ts`: Implements the 4 idempotent tasks with both `@Cron()` hooks and public runner methods accepting an optional reference `now: Date = new Date()`.
  - Wires `JobsModule` into `AppModule`.

### B. Job Specifications

#### 1. `cleanupExpiredEntities(now: Date = new Date())`
- **Queries & Mutations**:
  ```typescript
  const [invitations, sessions, verifications] = await this.systemPrisma.$transaction([
    this.systemPrisma.invitation.deleteMany({ where: { expiresAt: { lt: now } } }),
    this.systemPrisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    this.systemPrisma.verification.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  ```
- **Returns**: `{ deletedInvitations: number, deletedSessions: number, deletedVerifications: number }`.

#### 2. `releaseQuizGrades(now: Date = new Date())`
- **Candidate Quizzes**:
  ```typescript
  const eligibleQuizzes = await this.systemPrisma.quiz.findMany({
    where: {
      deletedAt: null,
      gradesReleasedAt: null,
      closesAt: { lte: now, not: null },
      gradeRelease: { in: ["on_close", "all_submitted"] },
    },
    include: {
      tenant: true,
      attempts: {
        include: {
          membership: { include: { user: true } },
          answers: true,
        },
      },
    },
  });
  ```
- **Auto-Submission of In-Progress Attempts**:
  - For attempts where `submittedAt === null`:
    - Calculate grade using `evaluateAttemptGrading(attempt.snapshot as unknown as QuizSnapshot, attempt.answers, quiz.passMark)`.
    - Update attempt with `submittedAt: closesAt`, `score`, `passed`.
- **Grade Release Marking & Notification**:
  - Set `quiz.gradesReleasedAt = now`.
  - For each completed attempt, trigger `NotificationsService.create`:
    - `type: "grade_released"`, `userId: attempt.membership.userId`, `tenantId: quiz.tenantId`.
    - `sendEmail: true`, `emailOptions: { quizTitle: quiz.title, score, maxScore, percentage, passed }`.
- **Returns**: `{ releasedQuizzes: number, notifiedAttempts: number }`.

#### 3. `cleanupPendingUploads(now: Date = new Date(), maxAgeMs = 24 * 60 * 60 * 1000)`
- **Candidate Assets**:
  ```typescript
  const cutoff = new Date(now.getTime() - maxAgeMs);
  const staleAssets = await this.systemPrisma.mediaAsset.findMany({
    where: {
      status: "pending",
      createdAt: { lt: cutoff },
    },
  });
  ```
- **Execution**:
  - Attempt R2 deletion for each storage key (swallowing 404 / NotFound).
  - Delete `mediaAsset` rows by IDs.
- **Returns**: `{ deletedAssets: number }`.

#### 4. `purgeSoftDeletedTenants(now: Date = new Date(), retentionMs = 30 * 24 * 60 * 60 * 1000)`
- **Candidate Tenants**:
  ```typescript
  const cutoff = new Date(now.getTime() - retentionMs);
  const expiredTenants = await this.systemPrisma.tenant.findMany({
    where: {
      status: "deleted",
      deletedAt: { lte: cutoff, not: null },
    },
    include: {
      mediaAssets: true,
    },
  });
  ```
- **Execution**:
  - For each tenant:
    1. Delete all R2 storage keys recorded in `mediaAssets`.
    2. Execute `this.systemPrisma.tenant.delete({ where: { id: tenant.id } })`.
- **Returns**: `{ purgedTenants: string[] }`.

---

## 3. Acceptance Gates (Step 10.1)
- **G1 (Expired Entities Cleanup)**: Deletes expired invitations, sessions, and verification records; preserves valid records. Running twice produces 0 deletions on second run.
- **G2 (Grade Release & Auto-Submit)**: Quizzes past `closesAt` with `on_close` or `all_submitted` auto-submit lingering attempts, set `gradesReleasedAt`, and dispatch in-app + email notifications. Running twice produces 0 releases on second run.
- **G3 (Pending Uploads Cleanup)**: Stale pending uploads older than 24h are deleted from DB and R2; recent pending and ready assets remain intact. Running twice produces 0 deletions on second run.
- **G4 (30-Day Tenant Purge)**: Tenants soft-deleted $\ge 30$ days ago have their R2 assets deleted and their DB records cascaded completely; recent soft-deleted (<30d) and active tenants are preserved. Running twice produces identical safe outcome.
- **G5 (Workspace Regression & Typecheck)**: `npm run typecheck` passes with zero errors across all workspaces.
