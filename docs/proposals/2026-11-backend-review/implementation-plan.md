# Implementation plan

Status: **superseded** (2026-11-17). Historical audit notes only. The approved design is in [ADR-012](../../adr/012-no-two-factor.md), [ADR-013](../../adr/013-account-provisioning.md), [ADR-014](../../adr/014-guardian-consent.md), the SRS and Phase 10R of [tasks/todo.md](../../../tasks/todo.md); where this file disagrees with them, they win.

## Where it fits

A new backend phase between Phase 10 (done) and Phase 11 (waits for the design): **Phase 10R, backend review changes (Track A)**. All of it is backend; no step builds UI. The UI it implies (staff management screens, the TOTP "trust this browser" checkbox) goes on the waiting list in `docs/12-ui-later.md`.

Two of the suggested phases drop out:
- **Database phase:** no schema change is needed (see [tenant-membership-design.md](tenant-membership-design.md)). Option C for 2FA is the only path that adds a migration.
- **Enrollment permission phase:** assistants can already enroll students, and a test covers it ([audit §6](lms-backend-audit.md#6-change-1-assistants-enroll-students-is-already-done)).

## Steps

| Step | What | Depends on |
|---|---|---|
| R.1 | Close public sign-up and unused Better Auth routes; guardian consent on code redemption | Decision 1, 2 |
| R.2 | Apply the 2FA decision | Decision 3 |
| R.3 | Super admin manages tenant teachers and assistants | Decision 4 |
| R.4 | Make Swagger testable in development (dev seed, same-origin auth) | R.2 (what staff must do at sign-in) |
| R.5 | Document every route in Swagger | R.1 to R.4 (the final route set) |
| R.6 | Phase checkpoint: full suite, audit, promotion | All |

Order: R.1 first because it closes two real gaps (F1, F2) with a small change. The 2FA decision shapes the seed and the Swagger auth text, so it comes before them. The new staff routes come before the documentation so they are documented once. R.4 comes before R.5 so every route can be tried while it is being described.

### R.1 Authentication cleanup

| | |
|---|---|
| Objective | No account can be created outside invitations and access codes; every new student membership records guardian consent. |
| Change | `disabledPaths` list in `packages/auth/src/auth.ts` ([list](authentication-simplification.md#how-to-switch-routes-off)). `CodeRedeemSchema` gets `isMinor` and `guardianConsent`; `code-redemption.service.ts` requires them and stores `guardian_consent_at` when it creates a membership. |
| Database | None |
| API | 15 Better Auth paths return 404. `POST /codes/redeem` returns 400 `GUARDIAN_CONSENT_REQUIRED` for a new member under 18 without consent. |
| Tests | Each disabled path is 404 through `auth.handler`; redeem by a new member: minor without consent refused, with consent stored; existing member unchanged; all existing auth, registration, invitation and code tests still pass. |
| Docs | `05-auth-devices.md` (route list), `07-api.md` (redeem body), `security-backlog.md` (tick the sign-up part of line 10). |
| Risk | A future page that needs a disabled route gets a 404. Turning it back on is a one-line change. |

### R.2 Two-factor policy

Depends on the owner's choice ([options](authentication-simplification.md#options)).

| Choice | Code | Docs | Tests |
|---|---|---|---|
| A+ (recommended) | None. Optionally set `trustDeviceMaxAge` explicitly to 30 days in `auth.ts`. | `05-auth-devices.md`: staff sign-in with "trust this browser"; `12-ui-later.md`: the checkbox on the TOTP page | One test: `verify-totp` with `trustDevice: true`, then a second sign-in skips the code |
| B | `access.guard.ts` `requireMfa` for super admins only; `staff-mfa.ts` `isStaffOrSuperAdmin` → super admin only | SRS FR-A03, `09-security.md` row 5, new ADR-012, `12-ui-later.md` | Update `access.int.spec.ts`, `staff-mfa.int.spec.ts` and the ~10 files that enrol staff TOTP |
| C | B, plus remove `twoFactor` and `staffMfaPlugin`, `/mfa/status`, `@AllowWithoutMfa`, `MFA_ENROLMENT_REQUIRED`; Prisma migration dropping `two_factor` and `users.two_factor_enabled` (Docker → Neon `dev` → `main`, rule 5) | As B, plus `04-database.md` | As B, plus remove the 2FA tests |

### R.3 Tenant staff management

| | |
|---|---|
| Objective | The super admin adds, lists, re-roles, suspends and removes teachers and assistants in any tenant. |
| Change | New `@SuperAdminOnly` routes under `/api/admin/tenants/{id}/staff` ([design](tenant-membership-design.md#proposed-api-super-admin-only-admin-host)). Move the create-or-link logic and the session-ending rule out of `assistants.service.ts` into one shared function used by both. Admin tenant responses return `teachers[]` and `assistantCount`. |
| Database | None |
| Authorization | Super admin only; last-active-teacher rule; explicit `tenantId` on every query (admin context is unscoped). |
| Tests | Listed in the [design](tenant-membership-design.md#tests-to-add): isolation between tenants, 403 for every non-super-admin, last-teacher 409, student-to-staff 409, multi-tenant staff keep other sessions, one audit entry per write. |
| Docs | SRS FR-T02 ("one or more teachers"), the SRS role table (also fixes F4), glossary in `00-index.md` ("Tenant: one academy's site", "Teacher: a manager of a tenant"), `07-api.md`, `12-ui-later.md` (staff screens on the super admin site). |
| Risk | Response shape change for admin tenant routes; nothing consumes it yet. |

### R.4 Swagger testability

| | |
|---|---|
| Objective | From `http://demo.localhost:4000/api/docs` a developer signs in and calls any route. |
| Change | Spike first: mount Better Auth on Nest in development (`docs-ui.ts`) and confirm sign-in works with Nest's body parser; fallback is a dev-only proxy to Next.js. Relative server in `document.ts`. `http://*.localhost:4000` in `trustedOrigins` outside production. Dev seed for super admin, teacher, assistant and student in `demo`, refused in production. |
| Credentials | 🔑 `SEED_SUPER_ADMIN_EMAIL`, `SEED_STAFF_PASSWORD`, `SEED_STUDENT_PASSWORD` (names added to `.env.example`; local test values only, owner fills them). |
| Tests | Seed is idempotent and refuses production; an integration test signs in through the dev mount; production build has neither the docs nor the mount (existing check for `/api/docs`, extended). |
| Risk | Dev and production serve `/api/auth` from different apps. The `auth` object, its config and the database are the same, so behaviour matches; only the hosting differs. |

### R.5 Swagger documentation

| | |
|---|---|
| Objective | Every route has a group, a summary, a "Who" line, a description, parameters, responses with reason codes and an example ([standard](swagger-redesign-plan.md#3-the-standard-for-every-operation)). |
| Change | `openapi/operations.ts` (the map), tag list and descriptions, shared error and cookie components, query and response schemas from `packages/shared`, Better Auth text overrides and hidden internal routes, journeys in the main description. Regenerate `docs/api/openapi.json`. |
| Tests | Extend `openapi.int.spec.ts`: every operation mapped, no stale keys, approved tags only, unique operationIds, `Who:` line present, disabled auth paths absent, export up to date. |
| Docs | README section on using Swagger; `07-api.md` points to Swagger for details. |
| Size | The largest step: about 100 operations of text. Written group by group, checked in the browser per group. |

### R.6 Phase checkpoint

- Full unit and integration suite on Docker Postgres, zero failures (rule 4).
- Isolation sweep and the new isolation tests.
- `typecheck` and lint for every workspace; `npm audit` and gitleaks (the CI security job).
- `security-and-hardening` review of the new admin routes and the auth config.
- Swagger checked in the browser: each group opened, one call per group run.
- Database: no migration (unless Option C), so nothing to promote to Neon. With Option C: Docker, then Neon `dev`, then `main` (rule 5).
- Commit and branch only with the owner's approval for that exact action.

## Testing strategy

| Level | What |
|---|---|
| Unit | Shared Zod schemas (redeem consent), `computePermissions` if roles change, OpenAPI map completeness |
| Integration (Docker Postgres) | Every new route, with `createTwoTenants` and `requestAs` for isolation; Better Auth handler 404s; registration and sign-in flows end to end |
| Regression | The whole existing suite after each step |
| Manual | Swagger in the browser after R.4 and R.5 |

## Rollback

Each step is one change that can be reverted on its own. None of R.1 to R.5 touches the schema, so reverting needs no data work. R.1 can also be undone by deleting entries from `disabledPaths`. Option C is the only one-way step: its migration drops the 2FA data, so staff would have to enrol again if it were reverted.

## Acceptance criteria

1. `POST /api/auth/sign-up/email` returns 404; no account can be created except through invitation, access code, admin tenant creation or the staff routes.
2. Every path that creates a student membership enforces guardian consent for minors.
3. The super admin can give a tenant two teachers and three assistants, change roles and remove them, and a tenant can never lose its last active teacher.
4. Staff of tenant A cannot see or change tenant B's staff, students or data through any new route (tests prove it).
5. The 2FA policy matches the owner's decision, and SRS, threat model and ADR say the same thing.
6. Swagger has 15 ordered groups, every operation fully documented, no unused auth routes, and works with "Try it out" in development.
7. Full test suite green; phase checkpoint passed.

## Decisions for the owner

1. **Switch off** the unused Better Auth routes listed in [authentication-simplification.md](authentication-simplification.md), including public sign-up?
2. **Guardian consent on code redemption** for people joining a new academy: require it (recommended), or accept the gap?
3. **2FA:** A+ (keep, trusted browser for 30 days, recommended), B (super admin only), C (remove) or D (email code)?
4. **Staff management:** super admin only (recommended), and the `teacher` → `teachers[]` response change?
5. **SRS role table (F4):** correct it to match the code (recommended), or change the code to give assistants code batches and ending enrollments?
6. **Swagger docs location:** one `operations.ts` map (recommended) or decorators on each controller?
7. **Optional extras:** S1 assistants generate codes, S2 staff view one student's progress, S4 consent step before linking an existing user as assistant, "set your password" email instead of temporary passwords. Each one yes or later.
