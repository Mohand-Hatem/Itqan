-- 10R.3 (ADR-013): access-code self-registrations stay `pending` until the email is verified.
-- Alone in its migration: PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE "UserStatus" ADD VALUE 'pending';
