# Security

## 1. Threat model

| # | Threat | Impact | Mitigation |
|---|---|---|---|
| 1 | Teacher A reads teacher B's data | Critical | `tenant_id` injected by Prisma extension; tenant from host only; isolation tests per endpoint; RLS later |
| 2 | Student shares account with friends | High (lost revenue) | Device binding, one active session, request + approval for changes, audit of blocked logins |
| 3 | Student gets answers before release | High | Answers never in student DTOs; built from snapshot with fields stripped; tests on every exam endpoint |
| 4 | Student edits score or deadline | High | Server-side grading and timing; client sends only selected option IDs |
| 5 | Staff or super admin account takeover | Critical | No two-factor authentication (owner decision, [ADR-012](adr/012-no-two-factor.md)): a correct stolen password is enough, and that risk is accepted. Mitigations: 12-character staff passwords, forced password change for directly created staff and on first staff role, rate-limited login, audit of every staff sign-in (success and failure), audit log of staff actions, session revocation, super admin created only by the bootstrap command. An IP allowlist for the super admin host is deferred. |
| 5a | Account takeover through a mistyped or unproven email | Medium | Directly created accounts stay unverified; password-reset and notification emails go only to verified addresses; verification for an active unverified account is sent only from its own session; only the super admin can reset another user's password ([05 §1a–1b](05-auth-devices.md)) |
| 6 | Brute force on codes or invitations | Medium | 60-bit codes, 256-bit tokens, HMAC/SHA-256 storage, rate limits |
| 7 | Stolen session cookie | Medium | HttpOnly, Secure, SameSite; student requests also need the device cookie |
| 8 | XSS through teacher pages or comments | High | Plain text for comments; teacher rich text sanitized (`sanitize-html`) on save; CSP header |
| 9 | Malicious file upload | Medium | MIME and size allow-list, files served from R2 (not our origin), `Content-Disposition` set, no server-side execution |
| 10 | CSRF | Medium | SameSite cookies, Better Auth origin checks, `trustedOrigins` limited to `*.<root-domain>` |
| 11 | Leaked video or PDF | Medium | Short signed URLs, watermark with student identity, enrollment checks. Cannot be fully prevented |
| 12 | SSE connection flood | Low | Auth required, max 5 streams per user, Cloudflare rate limiting |
| 13 | Secrets leak | Critical | Env vars only, never in client bundles; `NEXT_PUBLIC_` reviewed; secret scanning in CI |
| 14 | Data loss | Critical | Neon PITR + nightly dump to separate bucket; soft deletes; tested restore |
| 15 | Minors' personal data | Legal | Collect only name, email, optional phone; guardian consent recorded once per person by email link or signed offline form, with content closed until then ([ADR-014](adr/014-guardian-consent.md)); guardian details visible only to the super admin and the recording academy; document references, never scans; privacy policy; deletion on request. Email consent proves control of a mailbox, not parenthood: the lawyer decides whether it is enough (step 12.6a) |
| 16 | Tenant staff reach other academies through shared person data | Medium | Teachers and assistants cannot link existing accounts or reset passwords; only the super admin changes a student's minor status after creation; the last-teacher rule locks tenant rows. Consent recorded in one academy opens the others by design (FR-A06), and every recording is audited with its tenant |

## 2. Headers (Nginx / Next.js)
| Where | Headers |
|---|---|
| NestJS (`helmet`, `apps/api/src/app.setup.ts`), every response | `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` (the API serves only JSON and event streams), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, no `X-Powered-By` |
| Nginx, every response | `server_tokens off`; nosniff and Referrer-Policy when the upstream did not send them (no duplicates); `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`; `X-Powered-By` hidden |
| Nginx, HTTPS only (staging, production) | `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| Next.js pages | `poweredByHeader: false`. The page CSP (nonce-based; self + R2 + Firebase + Sentry + the design's font and script sources) is step 11.3 and waits for the design |

No CORS on the API: pages and `/api` share one host (Nginx, or Next.js rewrites in the preview), so no other origin may read API responses. Browser uploads go straight to R2, which has its own CORS rule. `npm run headers:check` scans the local stack; a public scan (Mozilla Observatory) runs once the domain exists (step 12.3).

## 3. Never log
Passwords (including passwords staff set for other people), session tokens, device secrets, invitation and guardian-consent tokens, access codes, presigned URLs, and the email typed in a failed sign-in to an unknown account. Sentry `beforeSend` scrubs cookies and auth headers.

## 4. Limits we tell teachers honestly
- We bind a browser, not a physical device. A student who copies a browser profile could move it.
- Screen recording and phone cameras cannot be blocked. The watermark identifies the leaker.
- "View-only" PDFs can still be captured.
- Two people can still use one account at different times if both devices were approved. Approve second devices carefully.

## 5. Before launch
- [ ] Tenant isolation test suite green.
- [ ] Exam answer-leak tests green.
- [ ] `npm audit` / Dependabot clean of high severity.
- [ ] External penetration test or a focused review of auth, device and exam flows.
- [ ] Restore from backup rehearsed.
- [ ] Privacy policy and terms published (legal review for minors).
