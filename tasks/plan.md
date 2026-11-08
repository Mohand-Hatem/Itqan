# Implementation plan: Itqan MVP

## Overview
A multi-tenant LMS on one deployment. The first release serves one teacher. The work is split into 10 phases of small steps (about half a day each), listed in [todo.md](todo.md). Every step follows the three gates in [../CLAUDE.md](../CLAUDE.md): step approval, design (🎨) and credentials (🔑).

## Architecture decisions
See [../docs/adr/](../docs/adr/). In short: shared multi-tenant DB (001), MP4 in R2 (002), no Redis/queue (003), cookie device binding (004), block-new-login single session (005), table + SSE + FCM notifications (006), global users with tenant memberships (007), npm workspaces (008).

## Phases and estimates
Estimates assume one full-time developer working with AI agents.

| # | Phase | Steps | Estimate |
|---|---|---|---|
| 0 | Planning and tooling | — | ✅ Done |
| 1 | Foundation | 10 | 1 week |
| 2 | Database and tenancy | 9 | 1 week |
| 3 | Design system and app shell 🎨 | 8 | 1.5 weeks |
| 4 | Authentication | 10 | 1.5 weeks |
| 5 | Devices and sessions | 10 | 1.5 weeks |
| 6 | Access and people | 12 | 2 weeks |
| 7 | Content and media | 12 | 2.5 weeks |
| 8 | Exams | 13 | 2.5 weeks |
| 9 | Notifications and engagement | 10 | 1.5 weeks |
| 10 | Hardening and launch | 9 | 1.5 weeks |
| | **Total** | **103** | **~16 weeks; 4–5 months with buffer (8–10 months part-time)** |

Each phase ends with a checkpoint: tests green, staging deployed, owner review.

## Credentials timeline (🔑)
| Phase | Needed |
|---|---|
| 1 | Root domain, Cloudflare account, VPS SSH access |
| 2 | Neon `DATABASE_URL` (pooled), `DIRECT_URL` |
| 4 | `BETTER_AUTH_SECRET` (generated locally), `RESEND_API_KEY`, verified sending domain |
| 7 | Cloudflare R2 account ID, access key, secret key, bucket names |
| 9 | Firebase web config, Firebase service account key |
| 10 | Sentry DSN, production Neon project, production VPS stack |

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Cross-tenant data leak | Critical | Prisma tenant extension and isolation tests from Phase 2 |
| Better Auth cannot run our device check before session creation | High | Spike in step 5.1; fallback is a custom sign-in endpoint in NestJS |
| Support load from locked-out students | High | Clear blocked screens, one-click approvals, pending-request badge |
| Device dies mid-exam | High | Extend time and move-device actions (step 8.12) |
| Exam-start spike with Neon scale-to-zero | Medium | Load test (step 8.13); paid always-on compute if needed |
| Video piracy | Medium | Watermark; Bunny Stream later |
| Emails in spam | Medium | SPF/DKIM/DMARC in step 4.3 |
| Legal issues with minors | Medium | Guardian consent, privacy policy, legal review (step 10.7) |
| Approval stops slow progress | Low | Steps sized to about half a day |

## Open questions
1. Root domain for the platform (needed in step 1.10).
2. Sending email domain and sender address (step 4.3).
3. Per-assistant permission toggles? (MVP: fixed role.)
4. Neon plan for production after the load test.
5. Legal review of consent and privacy for minors.
