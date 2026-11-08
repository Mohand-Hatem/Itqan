# Agent rules for teacher-lms

Read `docs/00-index.md` first. The docs are the source of truth; if code and docs disagree, stop and ask.

## Stack (do not swap without an ADR)
- Monorepo: pnpm workspaces. `apps/web` (Next.js App Router), `apps/api` (NestJS), `packages/*`.
- Prisma + Neon PostgreSQL. One Prisma client shared by the app and Better Auth.
- Better Auth for identity and sessions. NestJS owns all LMS authorization.
- Cloudflare R2 for files and MP4 videos. Resend for email. FCM for push. SSE for real-time.
- UI: Tailwind + shadcn/ui, TanStack Query, React Hook Form + Zod, next-intl (Arabic default, RTL).

## Never
- Never query tenant data without `tenant_id`. Use the tenant-scoped Prisma extension; raw queries must filter `tenant_id` by hand.
- Never trust tenant ID, user ID, role, device or limits sent by the client.
- Never send correct answers to a student before the configured review release.
- Never store raw tokens, codes or device secrets. Store hashes only. Never log them.
- Never store file or video binaries on the VPS or in Postgres.
- Never add Redis, BullMQ, microservices or Kubernetes without an ADR.
- Never run git commit, push, branch, merge, rebase or reset without the owner's explicit approval for that exact action.

## Always
- Business logic in services, not controllers.
- Transactions for multi-record writes (enrollment, code redemption, login device check, exam submit).
- An audit log entry for every admin action.
- A tenant-isolation test for every new tenant-scoped endpoint.
- Check current official docs for Better Auth, Prisma and Next.js before writing integration code.
- Small, reviewable changes that follow `tasks/todo.md`.
