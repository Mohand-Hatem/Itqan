# Authentication simplification

Status: **superseded** (2026-11-17). Historical audit notes only. The approved design is in [ADR-012](../../adr/012-no-two-factor.md), [ADR-013](../../adr/013-account-provisioning.md), [ADR-014](../../adr/014-guardian-consent.md), the SRS and Phase 10R of [tasks/todo.md](../../../tasks/todo.md); where this file disagrees with them, they win.

## Feature inventory

"Used" means called by our code or tests today, or required by an SRS line for a page still to be built. There is no frontend yet (Track A), so no page calls anything.

| Feature | Routes | Configured? | Used? | Required? | Dependencies | Recommendation |
|---|---|---|---|---|---|---|
| Student sign-in | `POST /sign-in/student` (ours) | Yes, `studentSignInPlugin` | Yes, many tests | FR-D01 to D05, ADR-011 | `devices`, `sessions.device_id`, `guardStudentSession` hook | Keep |
| Staff sign-in | `POST /sign-in/email` | Yes | Yes | FR-A01 | `staffMfaPlugin` after-hook, `guardStudentSession` refuses student-only users | Keep |
| Session | `GET/POST /get-session`, `POST /sign-out` | Yes | Yes, `SessionGuard` reads the session | FR-D07 | `sessions` | Keep |
| Session management | `GET /list-sessions`, `POST /revoke-session`, `/revoke-sessions`, `/revoke-other-sessions` | Yes (core) | No | Not in the SRS, useful for staff | `sessions` | Keep; already on the 11.8 audit list |
| Update session | `POST /update-session` | Yes (core) | No | No. Our session fields are `input: false`, so there is nothing to update. | none | **Switch off** |
| Password reset | `POST /request-password-reset`, `POST /reset-password`, `GET /reset-password/{token}` | Yes | Yes, tests | FR-A02 | Resend email, `verification` | Keep |
| Change password | `POST /change-password` | Yes (core) | No | Expected by any account page | `account` | Keep |
| Verify password | `POST /verify-password` | Yes (core) | No. Our device and sign-out requests check passwords internally. | No | none | **Switch off** |
| Email verification | `POST /send-verification-email`, `GET /verify-email` | Yes, required before sign-in | Yes, tests | FR-A01 | Resend, `verification` | Keep |
| Profile update | `POST /update-user` | Yes (core) | No | Name changes; the name appears in the video watermark | `users` | Keep (name length limit is in the security backlog) |
| Change email | `POST /change-email` | Off (Better Auth default: `user.changeEmail.enabled` unset) | No | No. Email is the identity invitations match on. | none | **Switch off** the route so it leaves Swagger |
| Account deletion | `POST /delete-user`, `GET /delete-user/callback` | Off (default: `user.deleteUser.enabled` unset) | No | No. Deletion is a super admin action (tenant purge). | none | **Switch off** |
| Public email sign-up | `POST /sign-up/email` | **On** | Production code: no. Tests: yes, through `auth.api.signUpEmail` (about 15 test files). | **Forbidden** by FR-A05 | `users`, `account`, verification email | **Switch off** (finding F1) |
| Social login and account linking | `POST /sign-in/social`, `GET/POST /callback/{id}`, `/link-social`, `/unlink-account`, `/list-accounts`, `/account-info`, `/refresh-token`, `/get-access-token` | No providers configured | No | No | `account` | **Switch off** (callback: hide from Swagger, see below) |
| TOTP 2FA | `/two-factor/enable`, `/get-totp-uri`, `/verify-totp`, `/disable`, `/generate-backup-codes`, `/verify-backup-code` | Yes, `twoFactor` plugin | Yes, `staff-mfa.int.spec.ts`, `AccessGuard.requireMfa` | FR-A03 | `two_factor` table, `users.two_factor_enabled` | Depends on the 2FA decision below |
| MFA status | `GET /mfa/status` (ours) | Yes, `staffMfaPlugin` | Tests | Only with mandatory 2FA | `isStaffOrSuperAdmin` | Goes with the 2FA decision |
| Email OTP 2FA | `/two-factor/send-otp`, `/two-factor/verify-otp` | Half: the plugin exposes the routes but no `sendOTP` function is set, so `send-otp` fails | No | No | none | **Switch off**, unless option D below is chosen |
| Utility | `GET /ok`, `GET /error` | Yes (core) | `/error` is where Better Auth redirects failed email links | n/a | none | Keep; hide `/error` from Swagger, list `/ok` under Health |

### How to switch routes off

Better Auth's `disabledPaths` option. In 1.7.20 it is checked in the HTTP router (`better-auth/dist/api/index.mjs`, `onRequest`): a listed path returns 404, and the OpenAPI generator skips it, so it also leaves Swagger. Server-side calls such as `auth.api.signUpEmail(...)` do not go through the router, so the test fixtures keep working.

`emailAndPassword.disableSignUp: true` is the other way to close sign-up, but it also blocks `auth.api.signUpEmail`, which would break about 15 test files. Our registration code does not need it either way: `/register`, `/register-with-code` and the admin and assistant routes hash the password with `auth.$context` and write the user directly.

```ts
// packages/auth/src/auth.ts (proposed)
disabledPaths: [
  "/sign-up/email",          // FR-A05: students join only by invitation or code
  "/sign-in/social", "/link-social", "/unlink-account", "/list-accounts",
  "/account-info", "/refresh-token", "/get-access-token",
  "/delete-user", "/delete-user/callback", "/change-email",
  "/update-session", "/verify-password",
  "/two-factor/send-otp", "/two-factor/verify-otp",
],
```

`/callback/{id}` has a dynamic segment, and `disabledPaths` matches exact paths, so it cannot be listed. With no providers configured it already returns an error. Swagger hides it with a filter in `openapi/document.ts`.

### After switching off: what must still work

| Check | How |
|---|---|
| Each switched-off path returns 404 through the real handler | New test calling `auth.handler(new Request(...))` for every listed path |
| Invitation registration, code registration, invitation accept, code redeem | Existing integration tests |
| Guardian consent on every path that creates a student membership | Existing tests, plus a new one for `/codes/redeem` (below) |
| Student and staff sign-in, reset, verification, 2FA | Existing tests (`student-sign-in`, `verification-reset`, `staff-mfa`) |
| No other route creates a user | `grep` for `user.create` and `signUpEmail` outside tests: only `register`, `register-with-code`, admin tenants and assistants today |

### Guardian consent on code redemption (finding F2)

`POST /codes/redeem` creates a new student membership with no consent check. Proposed fix, smallest version: when the caller has no membership in this tenant, require the same `isMinor` and `guardianConsent` fields as `/register-with-code` and store `guardian_consent_at`. When the caller is already a student there, nothing changes. This touches `CodeRedeemSchema` and `code-redemption.service.ts`, plus one test.

## Two-factor authentication

### Where the rule comes from

- **FR-A03** (`docs/02-srs.md:22`): "Teacher, assistants and super admin must use TOTP MFA." It is a written requirement, not something the code added on its own.
- **Threat model** (`docs/09-security.md:11`): "Staff or super admin account takeover", rated **Critical**, protected by "Mandatory TOTP, rate-limited login, audit log, session revocation".
- **Enforcement:** `AccessGuard.requireMfa` (403 `MFA_ENROLMENT_REQUIRED`), the `staffMfaPlugin` sign-in hook and `GET /mfa/status`, `@AllowWithoutMfa()` on `GET /me`, the `two_factor` table, tests in `staff-mfa.int.spec.ts` and about 10 other test files, a UI row in `docs/12-ui-later.md`, and a unit of the 11.8 security audit.

Changing it is a requirements change: it needs the SRS, the threat model and an ADR updated, not only code.

### What a stolen staff password gives today, without 2FA

| Account | What an attacker can do |
|---|---|
| Teacher | Generate and export access codes (each one is a sold course), enroll anyone, read students' names, emails and phone numbers (many are minors, under Saudi PDPL), suspend students, delete courses, change branding |
| Assistant | Everything above except code batches, ending enrollments, device limits, course deletion and settings |
| Super admin | Every tenant: create, pause or delete tenants, suspend any user |

Rate limits (5 sign-ins a minute) slow guessing but do nothing against a password that is correct, which is the common case: reused passwords and phishing. Students differ: a student account reaches only that student's own data and courses, and the device limit already stops casual account sharing.

### Options

| Option | Who must use 2FA | Experience | Work | Risk |
|---|---|---|---|---|
| **A+. Keep, with "trust this browser"** | Super admin, teachers, assistants (authenticator app) | Scan a QR code once. After that, a 6-digit code once every 30 days per browser. Better Auth already supports this (`trustDevice` on `verify-totp`, 30-day cookie). | Backend: none. The sign-in page sends `trustDevice: true`. | Lowest. Matches FR-A03 and the threat model. |
| B. Super admin only | Super admin | Teachers and assistants use email and password; they may still turn TOTP on | `access.guard.ts`, `staff-mfa.ts`, about 10 test files, SRS FR-A03, `09-security.md`, ADR-012, `12-ui-later.md` row | Teacher accounts (codes, minors' data) rest on the password alone |
| C. Remove 2FA | Nobody | Simplest sign-in | B's work, plus remove the `twoFactor` and `staffMfa` plugins, `/mfa/status`, `@AllowWithoutMfa`, the reason code, and a migration dropping `two_factor` and `users.two_factor_enabled` | Highest. A super admin password opens every tenant. |
| D. Email code for teachers and assistants, app for super admin | Everyone staff, no app for teachers and assistants | A code arrives by email at sign-in (with "trust this browser", once a month) | A `sendOTP` function and email template, method rules per role, tests | Medium. Stops reused passwords, but whoever controls the email inbox also controls password reset, so both factors fall together. Adds email cost and delay to staff sign-in. |

### Recommendation

**Option A+.** It is already built and tested, it costs no backend work, and the 30-day trusted browser removes most of the day-to-day friction, which is the real complaint. Removing 2FA (B or C) costs more work than keeping it and moves the platform's highest-rated threat to password-only protection.

If the owner still wants less friction for teachers and assistants, B is the safest fallback: the super admin account, which reaches every tenant, keeps the app.

## Staff provisioning

Account creation and 2FA are already separate. The super admin (`POST /admin/tenants`) and teachers (`POST /assistants`) create the account with a temporary password; nothing about 2FA happens then. 2FA comes up on first use: until the person enrols, staff routes return `MFA_ENROLMENT_REQUIRED`. The new staff routes in [tenant-membership-design.md](tenant-membership-design.md) keep it that way.

| Rule | Status today |
|---|---|
| Role assignment does not trigger MFA setup | True |
| No HTTP route creates or promotes a super admin | True: `is_super_admin` is `input: false` and no route writes it |
| Teachers and assistants cannot create teachers | True; the new admin routes keep that |

One optional improvement (not requested): the super admin chooses the teacher's temporary password and the teacher is never forced to change it, so the admin knows a working password. Sending a "set your password" email through the existing reset flow instead would remove that. It needs Resend working (step 12.4).
