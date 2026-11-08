# Agent rules for Itqan

Read `docs/00-index.md` first. The docs are the source of truth; if code and docs disagree, stop and ask.

## Workflow rules (everyone, every step)
Work follows `tasks/todo.md`: **Phase → Step**. One step at a time.

1. **Step gate.** Before starting a step, post this brief and stop:
   ```text
   Step X.Y — <name>
   What:           what this step builds
   How:            the approach and the files it touches
   Why:            the benefit once it's done
   How it works:   the mechanism, in plain words
   Needs from you: credentials or decisions (or "nothing")
   Done when:      how we check it worked
   ```
   Start only after the owner's explicit approval. One approval covers one step. After the step, report the result and tick it in `tasks/todo.md`.
2. **Design gate (🎨).** At step 3.1, stop and say "Design gate reached": the owner teaches the project's design method, which is then written to `docs/11-design.md`. Every later 🎨 step follows that doc. If a screen needs something the doc doesn't cover, stop again. Never choose styling, colors or layout on your own.
3. **Credentials gate (🔑).** When a step needs a secret: stop, add the variable names to `.env.example` with empty values, explain in 2–3 lines where to get each value, and wait until the owner confirms they put the real values in `.env`. Never ask for secrets in chat, never print them, never commit them.

## Stack (do not swap without an ADR)
- Monorepo: pnpm workspaces. `apps/web` (Next.js App Router), `apps/api` (NestJS), `packages/*`.
- Prisma + Neon PostgreSQL. One Prisma client shared by the app and Better Auth.
- Better Auth for identity and sessions. NestJS owns all LMS authorization.
- Cloudflare R2 for files and MP4 videos. Resend for email. FCM for push. SSE for real-time.
- UI: Tailwind + shadcn/ui, TanStack Query, React Hook Form + Zod, next-intl (Arabic default, RTL).

## Tools (setup: `docs/10-dev-setup.md`)
| Job | Use |
|---|---|
| Any UI design, critique or polish | `impeccable` skill |
| Motion and interaction details | `emil-design-eng`, `animate`, `review-animations` skills |
| Security review (end of each phase) | `security-audit` skill |
| Reviewing docs in `docs/` | `egm` plugin |
| Better Auth, Next.js, shadcn questions | `better-auth`, `next-devtools`, `shadcn` MCPs before memory |
| Checking a flow in the browser | `playwright` MCP |
| Database work | `neon` MCP on dev branches only; schema changes via Prisma migrations |

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
