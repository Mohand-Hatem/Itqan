# UI later: two tracks and the UI waiting list

The design is not chosen yet, so all UI work waits ([ADR-010](adr/010-backend-first-ui-later.md)). This file explains how work continues meanwhile and keeps the list of everything UI that is waiting.

## The rule in one line

Until the owner says the design is chosen, we build business logic only. Anything that is UI gets named in the step brief or report and added to the waiting list below.

## The two tracks

**Track A, now (business logic).** Every step in [`tasks/todo.md`](../tasks/todo.md) without ⏸, in order: Phase 4 → 9, then 10.1–10.5. Steps that mix an API and a page are split, and only the "a" part (API and tests) is done now.

**Track B, after the design is chosen (UI).** In this order:
1. Step 3.1, the design gate: the owner chooses the design and the method is written in `docs/11-design.md`.
2. The rest of Phase 3 (tokens, fonts and RTL, components, layouts, middleware and branding, states pages).
3. Phase U: every ⏸ step in its original order, each built on its finished API.
4. Step 3.8 (accessibility and responsive audit) and the UI checkpoints.
5. Phase 10 from step 10.6 (teacher preview) onward.

Track B must be done before step 10.6. The design can be chosen at any time: the step in progress is finished, then work switches to Track B. Choosing it before Phase 8 starts keeps the UI backlog from becoming one very large block.

## What counts as UI

Pages, components, layouts, styling, colours, fonts, icons, illustrations, animation, responsive behaviour, and the frontend wiring of a page (forms, TanStack Query hooks, client state). Also browser-only features: service workers and push (step 9.4).

Not UI, so it is done now: database, API endpoints, guards, validation schemas in `packages/shared`, reason codes and message keys the API returns, email content in plain layouts, tests.

## How the reminder looks

Every step brief has a "UI part" line (CLAUDE.md rule 1), for example:

```text
UI part:        waits for the design. The device-change request screen is added to docs/12-ui-later.md (step 5.5).
```

or `UI part: none` when the step is pure logic. If UI comes up in the middle of a step, the owner is told in one line and the item is added to "Found during Track A" below.

## Design candidates

Exploration lives in `screens/` as plain HTML test pages (currently `screens/test/` and `screens/test-2/`). Exploring designs there when the owner asks is allowed; it is how the design gets chosen, and it does not count as building UI.

## UI waiting list

Built in Phase U, in this order. "API from" is the Track A step the page uses.

| Step | UI to build | API from |
|---|---|---|
| 3.1–3.7 | Design gate, tokens, fonts and RTL, components, layouts, middleware and branding, states pages | — |
| 4.5 | Login, forgot-password and reset-password pages | 4.2, 4.4 |
| 4.9b | Frontend auth context, signed-in user in layouts | 4.9a |
| 5.5 | Blocked screens with reason messages | 4.8, 5.3 |
| 5.8b | `/manage/requests` approve and reject page | 5.8a |
| 5.10b | Student devices page | 5.10a |
| 6.2 | Course list and course form | 6.1 |
| 6.4 | `/join` page with guardian consent | 6.3 |
| 6.6b | Register-with-code and redeem pages | 6.6a |
| 6.8b | Students list and detail | 6.8a |
| 6.9b | Payments page | 6.9a |
| 6.10b | Assistant management page | 6.10a |
| 6.11b | Super admin tenant list and create tenant | 6.11a |
| 6.12b | Super admin pause, suspend, soft delete | 6.12a |
| 7.3 | Upload component with progress | 7.1, 7.2 |
| 7.5 | Tree editor with drag and drop | 7.4 |
| 7.7 | Student course page (tree and viewer) | 7.6 |
| 7.8 | PDF viewer and download policy | 7.6 |
| 7.9 | Video player, URL refresh, moving watermark | 7.6 |
| 7.12 | Settings page and public pages | 7.11 |
| 8.2 | Question editor | 8.1 |
| 8.4 | Quiz builder | 8.3 |
| 8.9 | Exam-taking page with countdown and autosave status | 8.5–8.7 |
| 8.11 | Results pages for students and staff | 8.10 |
| 9.3 | Bell and notifications page | 9.1, 9.2 |
| 9.4 | FCM web push and service worker | 9.1 |
| 9.6b | Announcements | 9.6a |
| 9.7b | Lesson Q&A | 9.7a |
| 9.8b | Support requests | 9.8a |
| 9.9b | Analytics overview | 9.9a |
| 9.10b | Audit log page with filters | 9.10a |
| 3.8 | Accessibility and responsive audit of everything above | — |

### Found during Track A

UI items that come up while building logic and are not in the table above. Each row names the step that found it.

| Found in step | UI item | Notes |
|---|---|---|
| — | — | — |
