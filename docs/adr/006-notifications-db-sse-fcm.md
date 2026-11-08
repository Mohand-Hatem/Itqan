# ADR-006: Notifications via table + SSE + FCM + email

**Status:** Accepted · 2026-11-08

**Context:** The product needs real-time and push notifications. Options included WebSockets, Redis pub/sub and in-process EventEmitter.

**Decision:** The `notifications` table is the source of truth. SSE delivers to open tabs. FCM delivers push when the site is closed. Resend sends email for important types.

**Consequences:** No extra infrastructure. SSE is one-way, which is enough for notifications; live chat would need WebSockets. iPhone push needs the site installed as a PWA (iOS 16.4+).
