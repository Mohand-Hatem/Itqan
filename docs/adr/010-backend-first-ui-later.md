# ADR-010: Business logic first, UI after the design is chosen

**Status:** Accepted · 2026-11-11

**Context:** Phase 3 starts with the design gate (step 3.1), and the owner has not chosen the design yet. Candidates live in `screens/` as plain HTML test pages. Every 🎨 step depends on `docs/11-design.md`, so following `tasks/todo.md` in order would stop all work until the design is decided. Most steps in Phases 4–10 are database, API and test work that does not depend on colours, fonts or layout.

**Decision:**
1. Work runs on two tracks, one after the other.
   - **Track A (now):** every step that is not UI. Steps that mix an API and a page are split: the "a" part (API, tests) is done now, the "b" part (page) waits.
   - **Track B (after the design is chosen):** Phase 3, then "Phase U", which builds every waiting UI step in its original order on top of finished APIs.
2. Phase 3 is paused, not skipped. All 🎨 steps carry ⏸ in `tasks/todo.md` and are listed in `docs/12-ui-later.md`.
3. Each phase closes with an **API checkpoint** now (full unit and integration suite green on Docker Postgres) and a **UI checkpoint** in Phase U. A phase is complete only when both are green.
4. Track B must be finished before step 10.6, because the teacher preview needs real pages.
5. During Track A, any UI that comes up is not built, not even as a placeholder. It is named to the owner and added to the waiting list (CLAUDE.md rule 6).

**Consequences:** Work continues while the design is open, and the UI is built once, on stable APIs, instead of being redone after a late design change. The costs:
- Endpoints may need small additions (a field, a filter) when the pages are built.
- Browser-only behaviour (device cookie in a real browser, SSE in an open tab, push, upload progress, video watermark) is proven late. Integration tests cover the server side now; browser tests run in Phase U.
- The UI backlog becomes one large block of work (Phase 3 plus 28 steps). Choosing the design before Phase 8 starts lets the UI be built in batches.
