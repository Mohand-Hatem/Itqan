# ADR-013: Account provisioning, account states and staff management

**Status:** Accepted · 2026-11-17

**Context:** Accounts were created in three places with different rules: the super admin created a tenant's single teacher, teachers created or silently linked assistants, and students joined by invitation or access code. Directly created accounts were marked email-verified although nobody had proved the mailbox, and the admin API showed only one teacher per tenant. The owner wants staff to create accounts directly or by invitation, several teachers and assistants per tenant, and assistants able to create students.

**Decision:**
1. **One `ProvisioningService`** creates accounts in two modes. *Direct:* the creator sets the password; the account is active at once; no email is sent; the email stays unverified. *Invitation:* one Resend email; the recipient sets their own password; accepting proves the mailbox. The super admin creates any role in any tenant, the teacher assistants and students in their tenant, the assistant students in their tenant.
2. **Existing accounts:** teachers and assistants get 409 `USE_INVITATION` and must invite the person, who accepts. The super admin can link an existing account directly (audited), without changing its password, profile or other memberships, and never making it a super admin.
3. **Account states are separate from email verification.** `users.status` is `active`, `pending` (access-code registration not verified yet) or `suspended`; `users.email_verified` only says whether the mailbox is proven. One session guard refuses every status but `active`. Better Auth's global `requireEmailVerification` is turned off; our guard applies the rule per account. Accepting an invitation marks the email verified; an account that cannot sign in yet accepts with the invitation token plus its own password.
4. **Unverified addresses are not trusted:** no password-reset or notification email goes to them. Only the super admin can reset another user's password (never another super admin's); that ends all of the user's sessions and forces a password change. Teachers and assistants cannot reset passwords.
5. **Passwords:** staff and super admins at least 12 characters, students at least 8, enforced at every entry point. `users.must_change_password` makes directly created staff (always) and students (by choice, default on) change the password at first sign-in, and is also set by an administrative reset and when an account gets its first staff role; until it is cleared only `GET /me` answers.
6. **Several teachers and assistants per tenant** with the existing `memberships` table (one role per person per tenant). The super admin manages all staff; teachers manage assistants; assistants manage no staff. A tenant always keeps one active teacher: removing, demoting or suspending the last one, or suspending that user globally, is refused with 409 after locking the tenant rows. Tenant responses list `teachers[]` with `assistantCount` and `studentCount`; the full list is a paginated members route.
7. **The first super admin comes from a bootstrap command** run on the server, which also recovers a super admin's password. No HTTP route creates or promotes a super admin.

**Consequences:**
- Migrations: `pending` status and `must_change_password` (10R.3), `invitations.role` (10R.6). No new membership or staff table.
- `POST /assistants` stops linking existing users silently, and `POST /admin/tenants` stops marking the teacher's email verified.
- A person who forgets the password of an unverified account needs the super admin.
- Existing staff accounts must change their password once after migration 10R.3, because a stored hash cannot show the old length.
- The tenant API response shape changes (`teacher` becomes `teachers[]`); no frontend or other consumer used it.
