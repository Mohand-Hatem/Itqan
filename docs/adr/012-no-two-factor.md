# ADR-012: No two-factor authentication; email and password for every role

**Status:** Accepted · 2026-11-17 · Replaces FR-A03's TOTP rule (step 4.6, enforced in 10.3)

**Context:** Teachers, assistants and super admins had to set up an authenticator app (TOTP) before any staff route worked. The owner wants a simpler sign-in for everyone. The threat model rates staff or super admin account takeover as Critical: a teacher account can generate access codes (which are sold), read students' names, emails and phone numbers (many are minors), and delete courses; the super admin account reaches every academy.

**Decision:**
1. Remove two-factor authentication completely: the Better Auth `twoFactor` plugin, our `staffMfaPlugin`, `GET /api/auth/mfa/status`, the `MFA_ENROLMENT_REQUIRED` rule in `AccessGuard`, backup codes and email codes. Every role signs in with email and password.
2. In the same change, switch off the Better Auth routes the LMS does not use (`disabledPaths`): public sign-up, social login and account linking, account deletion, email change, `update-session`, `verify-password` ([05 §1d](../05-auth-devices.md)).
3. Keep a baseline that does not depend on a second factor: staff and super admin passwords of at least 12 characters, a forced password change for directly created staff and on a first staff role, an audit row for every staff sign-in (success and failure, no secrets), the existing rate limits, session revocation, and a super admin created only by the bootstrap command.
4. Remove the `two_factors` table and `users.two_factor_enabled`. The code stops using them first (10R.2). The destructive migration (M4) runs only after every environment's rows are counted, a backup is verified and the owner approves that migration on its own.
5. An IP allowlist for the super admin host is deferred.

**Consequences:**
- Accepted risk: a correct staff password (reused or phished) is enough to take over a staff account. Nothing in the baseline stops that; the sign-in audit only makes it visible. `docs/09-security.md` row 5 says so.
- Staff can test the API right after signing in, with no enrolment step.
- The step 10.3 fix "staff TOTP enforced" and the TOTP rows in `docs/12-ui-later.md` are withdrawn. The 11.8 audit unit "Better Auth account and two-factor endpoints" shrinks to the kept account routes.
- The legal drafts no longer promise two-factor authentication.
- Turning 2FA back on later would need the plugin, the table and enrolment for every staff member again.
