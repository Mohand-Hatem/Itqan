# ADR-011: Students sign in through our own endpoint inside Better Auth

**Status:** Accepted · 2026-11-12

**Context:** The student login rules ([05-auth-devices.md §3](../05-auth-devices.md)) must lock the user row, check devices and open sessions, and create the session in **one transaction**, so two parallel logins cannot both pass. The doc left open whether this fits in a Better Auth hook or needs a custom sign-in endpoint. Step 5.1 tested both against Docker Postgres with Better Auth 1.7.20 (`packages/auth/src/spike-device-login.int.spec.ts`).

What the spike showed:

| Check | Hook on stock `/sign-in/email` (`databaseHooks.session.create.before`) | Own endpoint inside Better Auth (plugin) |
|---|---|---|
| Runs after the password check | Yes | Yes (calls `ctx.context.password.verify`) |
| Blocks with a reason code, no session left behind | Yes | Yes |
| Sets the device cookie, adds fields to the session | Yes | Yes |
| Two parallel logins for one user | **Both pass, 2 sessions** | One passes, the other gets `SESSION_ON_OTHER_DEVICE` |

The stock sign-in route calls `createSession` outside any transaction, and the Prisma adapter has transactions off by default. A hook can check, but it cannot hold a lock until the session row is written, so the one-session rule (ADR-005) breaks under a race.

**Decision:**
1. Students sign in through our own endpoint, added as a Better Auth plugin endpoint (like `staffMfaPlugin`), so it reuses Better Auth's password check, `internalAdapter.createSession` and `setSessionCookie`. It runs steps 4–8 of §3 inside `runWithTransaction` from `@better-auth/core/context`, and takes the user row lock with an update through the transaction adapter.
2. Turn on `transaction: true` in `prismaAdapter`. This also makes Better Auth's own multi-write flows (sign-up, reset) real transactions.
3. Close the other ways a student session can be created: a `databaseHooks.session.create.before` guard rejects a student session that did not come from our endpoint. This covers stock `/sign-in/email` and `/verify-email` (we have `autoSignInAfterVerification: true`). Staff and super admins keep the stock sign-in and the TOTP flow; the student endpoint answers them with `USE_STAFF_SIGN_IN`. `autoSignInAfterVerification` is off, so verifying an email never signs a student in (owner decision, step 5.3).

**Consequences:**
- One login path for students, with the race closed by the row lock. Better Auth still owns passwords, tokens and cookies.
- `@better-auth/core` becomes a direct dependency of `packages/auth`, pinned to the same version as `better-auth`. `runWithTransaction` is a public export, but it lives in the core package, so a Better Auth upgrade must re-run the parallel-login test.
- The endpoint runs in the Next.js `/api/auth/*` handler, so it needs the tenant from the `Host` header. The resolver lives in `apps/api/src/tenancy` today. Step 5.3 moves it to a shared package.
- Turning on adapter transactions changes how Better Auth writes. The full suite must stay green when step 5.3 does it.
- The spike test is throwaway: step 5.3 replaces it with the real login tests (first bind, `DEVICE_LIMIT`, `SESSION_ON_OTHER_DEVICE`, parallel logins, same device on another tenant).
