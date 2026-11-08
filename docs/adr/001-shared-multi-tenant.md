# ADR-001: Shared multi-tenant deployment

**Status:** Accepted · 2026-11-08

**Context:** We start with one teacher but plan to sell to many. Separate installations mean N deployments, N databases and N migration runs per release.

**Decision:** One deployment and one database. Every tenant-owned row has `tenant_id`, injected by a Prisma extension. Tenant resolved from the subdomain. Launch with one tenant created by a seed script; no teacher self-signup.

**Consequences:** Cheap to run and update. A missing tenant filter would leak data, so isolation tests are mandatory and RLS is the planned second lock. Custom domains need Cloudflare for SaaS later.
