-- 10R.3 (FR-A08, FR-A09): staff who must choose a new password can use only GET /me until they do.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- Account status and email verification are separate (ADR-013). Until now every unverified
-- account came from self-registration (access code or the old public sign-up), so it waits for
-- its verification link. Staff accounts made by the super admin or a teacher were marked verified.
UPDATE "users"
SET "status" = 'pending'
WHERE "email_verified" = false
  AND "status" = 'active';

-- A stored hash cannot show how long a password is, so every existing staff account and super
-- admin chooses a new one under the 12-character rule.
UPDATE "users"
SET "must_change_password" = true
WHERE "is_super_admin" = true
   OR "id" IN (
     SELECT "user_id" FROM "memberships" WHERE "role" IN ('teacher', 'assistant')
   );
