# Gates: Phase 6.12a Super Admin Lifecycle & Access Control API (FR-T03, FR-T04)

OWNS: packages/shared/src/schemas/tenants-admin.ts packages/shared/src/index.ts apps/api/src/tenants-admin/** tasks/todo.md docs/designs/phase-6.12a-admin-lifecycle-api.md

Scope: Implement Super Admin lifecycle controls: role pausing (`PATCH /api/admin/tenants/:id`), tenant soft deletion (`DELETE /api/admin/tenants/:id`), global user suspension (`PATCH /api/admin/users/:id`), atomic session eviction, host cache invalidation, and self-suspension safety guard.

- [x] G1: Shared Zod contracts defined and package compiles cleanly
  CHECK: npm run build -w @itqan/shared
  EXPECT: passed
  VERIFIED: `@itqan/shared@0.1.0 build` exited 0 with `AdminTenantUpdateSchema`, `AdminTenantSoftDeleteResponseSchema`, `AdminUserUpdateSchema`, `AdminUserUpdateResponseSchema`.

- [x] G2: Tenant role pausing and selective session eviction integration tests pass (Done condition: pausing students ends their sessions while teacher still works)
  CHECK: npx vitest run apps/api/src/tenants-admin/admin-tenants-lifecycle.int.spec.ts -t "Role Pausing"
  EXPECT: passed
  VERIFIED: Passed (3 tests). Pausing student role evicts student session and returns 401 on next request and 403 TENANT_PAUSED on login; teacher session remains 200 OK.

- [x] G3: Tenant soft deletion and host resolution disabling integration tests pass (Done condition: soft-deleting terminates all tenant sessions and disables subdomain resolution to 404)
  CHECK: npx vitest run apps/api/src/tenants-admin/admin-tenants-lifecycle.int.spec.ts -t "Soft Deletion"
  EXPECT: passed
  VERIFIED: Passed (1 test). All sessions deleted, cache invalidated, subsequent subdomain requests receive 404 TENANT_NOT_FOUND.

- [x] G4: Global user suspension and self-suspension guard integration tests pass (suspending user evicts all sessions globally, subsequent calls return 403, self-suspension returns 400)
  CHECK: npx vitest run apps/api/src/tenants-admin/admin-tenants-lifecycle.int.spec.ts -t "User Suspension"
  EXPECT: passed
  VERIFIED: Passed (2 tests). Suspending user evicts sessions across all tenants; self-suspension blocked with 400 CANNOT_SUSPEND_SELF.

- [x] G5: Role barriers and authorization tests pass (non-super-admins receive 403, anonymous receives 401)
  CHECK: npx vitest run apps/api/src/tenants-admin/admin-tenants-lifecycle.int.spec.ts -t "Role Barriers"
  EXPECT: passed
  VERIFIED: Passed (2 tests). Teachers, assistants, and students receive 403; unauthenticated callers receive 401.

- [x] G6: Full monorepo typecheck, lint, and full test suite pass with zero regressions (test count > 393)
  CHECK: npm run typecheck && npm run lint && npm test
  EXPECT: passed
  VERIFIED: Typecheck clean across all packages. ESLint clean (0 errors, 0 warnings). 53/53 test files passed, 401/401 tests green.
