# ADR-009: Local Docker during development, Vercel + Render preview, VPS only after approval

**Status:** Accepted · 2026-11-09

**Context:** No VPS or domain is bought until the teacher sees the product and approves it. Running the whole stack on Vercel would break tenant subdomains (wildcards need Vercel nameservers), long SSE connections, in-memory SSE fan-out and `@nestjs/schedule` jobs, because NestJS becomes a serverless function there.

**Decision:**
1. **Local:** all development and tests run on the docker-compose stack (Postgres, web, api, nginx), the same stack the VPS will run. Tenant subdomains are tested with `<slug>.localhost`.
2. **Preview (once, before the demo):** web on Vercel, API as a Docker service on Render's free tier, database on Neon `dev`. Next.js rewrites send `/api/*` (except `/api/auth/*`) to the API, so the browser sees one origin. One demo tenant comes from `PREVIEW_TENANT_SLUG`, which is ignored when `NODE_ENV=production` on the VPS. The device cookie is host-only on the preview, because `vercel.app` is a public suffix and cannot hold a parent-domain cookie.
3. **After approval:** buy the VPS and domain, bring up VPS staging, then production. The preview is shut down.

**Consequences:** No server cost before the teacher says yes, and production parity comes from the local Docker stack. Multi-tenant routing cannot be shown on the preview (one tenant only). Render's free API sleeps when idle, so open the link before a demo. Vercel's Hobby plan is for non-commercial use, so switch to Pro for the weeks the teacher uses the preview. Check both providers' current limits in step 10.6.
