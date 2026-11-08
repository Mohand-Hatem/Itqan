# ADR-005: One active session; block the new login

**Status:** Accepted · 2026-11-08

**Context:** Options were "new login kicks the old one", "heartbeat-based online detection", or "blocked until the student signs out".

**Decision:** A login is blocked while an unexpired session exists on another device. Sessions end on sign-out, admin action, or 30 days of inactivity. No heartbeat. Rescue: "request sign-out of other device", approved by staff.

**Consequences:** Simplest and strictest. A dead or lost device blocks the student until staff approve, so approvals must be fast, and exams need the extend-time and move-device actions.
