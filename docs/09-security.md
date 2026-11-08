# Security

## 1. Threat model

| # | Threat | Impact | Mitigation |
|---|---|---|---|
| 1 | Teacher A reads teacher B's data | Critical | `tenant_id` injected by Prisma extension; tenant from host only; isolation tests per endpoint; RLS later |
| 2 | Student shares account with friends | High (lost revenue) | Device binding, one active session, request + approval for changes, audit of blocked logins |
| 3 | Student gets answers before release | High | Answers never in student DTOs; built from snapshot with fields stripped; tests on every exam endpoint |
| 4 | Student edits score or deadline | High | Server-side grading and timing; client sends only selected option IDs |
| 5 | Staff or super admin account takeover | Critical | Mandatory TOTP, rate-limited login, audit log, session revocation |
| 6 | Brute force on codes or invitations | Medium | 60-bit codes, 256-bit tokens, HMAC/SHA-256 storage, rate limits |
| 7 | Stolen session cookie | Medium | HttpOnly, Secure, SameSite; student requests also need the device cookie |
| 8 | XSS through teacher pages or comments | High | Plain text for comments; teacher rich text sanitized (`sanitize-html`) on save; CSP header |
| 9 | Malicious file upload | Medium | MIME and size allow-list, files served from R2 (not our origin), `Content-Disposition` set, no server-side execution |
| 10 | CSRF | Medium | SameSite cookies, Better Auth origin checks, `trustedOrigins` limited to `*.<root-domain>` |
| 11 | Leaked video or PDF | Medium | Short signed URLs, watermark with student identity, enrollment checks. Cannot be fully prevented |
| 12 | SSE connection flood | Low | Auth required, max 5 streams per user, Cloudflare rate limiting |
| 13 | Secrets leak | Critical | Env vars only, never in client bundles; `NEXT_PUBLIC_` reviewed; secret scanning in CI |
| 14 | Data loss | Critical | Neon PITR + nightly dump to separate bucket; soft deletes; tested restore |
| 15 | Minors' personal data | Legal | Collect only name, email, optional phone; guardian consent; privacy policy; deletion on request |

## 2. Headers (Nginx / Next.js)
`Strict-Transport-Security`, `Content-Security-Policy` (self + R2 + Firebase + Sentry), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal. NestJS: `helmet`.

## 3. Never log
Passwords, session tokens, device secrets, invitation tokens, access codes, presigned URLs. Sentry `beforeSend` scrubs cookies and auth headers.

## 4. Limits we tell teachers honestly
- We bind a browser, not a physical device. A student who copies a browser profile could move it.
- Screen recording and phone cameras cannot be blocked. The watermark identifies the leaker.
- "View-only" PDFs can still be captured.
- Two people can still use one account at different times if both devices were approved. Approve second devices carefully.

## 5. Before launch
- [ ] Tenant isolation test suite green.
- [ ] Exam answer-leak tests green.
- [ ] `pnpm audit` / Dependabot clean of high severity.
- [ ] External penetration test or a focused review of auth, device and exam flows.
- [ ] Restore from backup rehearsed.
- [ ] Privacy policy and terms published (legal review for minors).
