# ADR-007: Global users, per-tenant memberships

**Status:** Accepted · 2026-11-08

**Context:** Better Auth makes email unique across all users. A student may study with two teachers.

**Decision:** One `user` per email (global login). A `membership` per tenant holds role, status and all tenant data links. Device and one-session rules apply per user, across tenants.

**Consequences:** One password per person. Tenants never see each other's data about the same person. Siblings cannot share one email.
