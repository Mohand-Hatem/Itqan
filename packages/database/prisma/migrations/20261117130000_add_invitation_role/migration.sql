-- 10R.6 (FR-E01, ADR-013): invitations can add teachers and assistants, not only students.
-- Every existing invitation was a student invitation.
ALTER TABLE "invitations" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'student';
