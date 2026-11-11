# Implementation plan: Itqan MVP

## Overview
A multi-tenant LMS on one deployment. The first release serves one teacher. The work is split into 10 phases of small steps (about half a day each), listed in [todo.md](todo.md). Every step follows the gates in [../CLAUDE.md](../CLAUDE.md): step approval, design (🎨), credentials (🔑) and testing.

**Current order (ADR-010):** the design is not chosen yet, so Phase 3 and every UI step (⏸) wait. Track A builds the business logic of Phases 4–9 and steps 10.1–10.5 now. Track B runs after the owner chooses the design: Phase 3, then Phase U (all waiting UI steps), then Phase 10 from 10.6. Details and the UI waiting list: [../docs/12-ui-later.md](../docs/12-ui-later.md).

## Architecture decisions
See [../docs/adr/](../docs/adr/). In short: shared multi-tenant DB (001), MP4 in R2 (002), no Redis/queue (003), cookie device binding (004), block-new-login single session (005), table + SSE + FCM notifications (006), global users with tenant memberships (007), npm workspaces (008), local Docker + Vercel/Render preview before buying the VPS (009), business logic first and UI after the design is chosen (010).

## Phases and estimates
Estimates assume one full-time developer working with AI agents.

| # | Phase | Steps | Estimate |
|---|---|---|---|
| 0 | Planning and tooling | — | ✅ Done |
| 1 | Foundation | 9 | ✅ Done |
| 2 | Database and tenancy | 9 | 1 week |
| 3 | Design system and app shell 🎨 ⏸ (Track B) | 8 | 1.5 weeks |
| 4 | Authentication | 10 | 1.5 weeks |
| 5 | Devices and sessions | 10 | 1.5 weeks |
| 6 | Access and people | 12 | 2 weeks |
| 7 | Content and media | 12 | 2.5 weeks |
| 8 | Exams | 13 | 2.5 weeks |
| 9 | Notifications and engagement | 10 | 1.5 weeks |
| U | UI build ⏸ (Track B): the waiting UI steps of Phases 4–9 | 28 | built step by step after the design; estimates stay inside Phases 4–9 |
| 10 | Preview, hardening and launch | 13 | 2.5 weeks (plus waiting for the teacher's decision) |
| | **Total** | **106** | **~17 weeks; 4–5 months with buffer (8–10 months part-time)** |

Each phase ends with an API checkpoint (Track A) and a UI checkpoint (Phase U): full test suite green on the local Docker stack, owner review. A phase is complete only when both are green. There is no hosted environment until the teacher preview (ADR-009).

## Credentials timeline (🔑)
| Phase | Needed |
|---|---|
| 2 | Local Docker `DATABASE_URL` (no account); Neon `DATABASE_URL` (pooled) and `DIRECT_URL` for the `dev` branch at step 2.9 |
| 4 | `BETTER_AUTH_SECRET` (generated locally), `RESEND_API_KEY` (test sender, no domain) |
| 7 | Cloudflare R2 account ID, access key, secret key, bucket names |
| 9 | Firebase web config, Firebase service account key |
| 10 | Vercel and Render accounts (preview); after approval: VPS SSH, root domain, Cloudflare DNS and origin cert, Resend domain records, Sentry DSN, Neon `main` |

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Cross-tenant data leak | Critical | Prisma tenant extension and isolation tests from Phase 2 |
| Better Auth cannot run our device check before session creation | High | Spike in step 5.1; fallback is a custom sign-in endpoint in NestJS |
| Support load from locked-out students | High | Clear blocked screens, one-click approvals, pending-request badge |
| Device dies mid-exam | High | Extend time and move-device actions (step 8.12) |
| Exam-start spike with Neon scale-to-zero | Medium | Load test (step 8.13); paid always-on compute if needed |
| Video piracy | Medium | Watermark; Bunny Stream later |
| Emails in spam | Medium | SPF/DKIM/DMARC in step 10.9 |
| Surprises when moving to the VPS late | Medium | Every phase runs the same docker-compose stack locally; VPS staging (10.8) comes before production |
| Preview differs from production (one tenant, serverless web, sleeping API) | Low | Preview is only for the demo; multi-tenant routing is tested locally |
| Legal issues with minors | Medium | Guardian consent, privacy policy, legal review (step 10.5) |
| Approval stops slow progress | Low | Steps sized to about half a day |
| Design not chosen; UI piles up into one large block | Medium | Two tracks (ADR-010); choose the design before Phase 8 starts so the UI is built in batches |
| APIs built before their pages miss a field or filter | Low | Endpoints follow `docs/07-api.md`; small additions expected in Phase U |
| Browser-only behaviour proven late (device cookie, SSE tab, push, upload, watermark) | Medium | Integration tests now; browser tests in the UI checkpoints |

## Open questions
1. Root domain for the platform (bought in step 10.8, after the teacher approves).
2. Sending email address on that domain (step 10.9).
3. Per-assistant permission toggles? (MVP: fixed role.)
4. Neon plan for production after the load test.
5. Legal review of consent and privacy for minors.
