# Implementation plan: Itqan MVP

## Overview
A multi-tenant LMS on one deployment. The first release serves one teacher. The highest-risk parts (tenant isolation, device binding, one-session rule) are built first so they fail early. Tasks live in [todo.md](todo.md).

## Architecture decisions
See [../docs/adr/](../docs/adr/). In short: shared multi-tenant DB (001), MP4 in R2 (002), no Redis/queue (003), cookie device binding (004), block-new-login single session (005), table + SSE + FCM notifications (006), global users with tenant memberships (007).

## Phases
| Phase | Tasks | Outcome |
|---|---|---|
| 1. Foundation | 1–4 | Monorepo, DB, tenant isolation, staging online |
| 2. Auth and devices | 5–10 | Login, MFA, device binding, single session, requests |
| 3. Access | 11–15 | Courses, invitations, codes, students, payments, super admin |
| 4. Content | 16–20 | Uploads, course tree, PDF and video viewing, branding |
| 5. Exams | 21–24 | Banks, quizzes, attempts, grading, release |
| 6. Engagement and launch | 25–30 | Notifications, Q&A, analytics, jobs, hardening |

Each phase ends with a checkpoint: tests green, staging deploy, owner review.

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Cross-tenant data leak | Critical | Prisma tenant extension in task 3, isolation test per endpoint |
| Better Auth cannot run our device check before session creation | High | Spike in task 8; fallback is a custom sign-in endpoint in NestJS that calls Better Auth's API |
| Support load from locked-out students | High | Clear blocked screens, one-click approvals, pending-request badge on dashboard |
| Device dies mid-exam | High | Extend time and move-device actions (task 24) |
| Exam-start spike with Neon scale-to-zero | Medium | Load test before first real exam; paid always-on compute if needed |
| Video piracy | Medium | Watermark; Bunny Stream later |
| Emails in spam | Medium | SPF/DKIM/DMARC before launch (task 5) |
| Legal issues with minors | Medium | Guardian consent, privacy policy, legal review (task 30) |

## Open questions
1. Root domain for the platform (brand name: Itqan).
2. Sending email domain and sender address.
3. Do teachers want per-assistant permission toggles? (MVP: fixed role.)
4. Neon plan for production (free vs always-on) after the load test.
5. Legal review of consent and privacy for minors.
