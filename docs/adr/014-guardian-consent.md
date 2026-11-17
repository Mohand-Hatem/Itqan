# ADR-014: Guardian consent once per person, by email link or signed offline form

**Status:** Accepted · 2026-11-17 · Replaces the checkbox in FR-A06

**Context:** Students under 18 needed a guardian-consent checkbox at registration, stored per membership (`memberships.guardian_consent_at`). The student ticks that box, so it does not show that a guardian agreed. Code redemption could create a membership with no consent at all, and staff will now create student accounts directly, where an administrator's action cannot stand in for a guardian's consent. The owner does not want consent asked again at every code redemption.

**Decision:**
1. Consent belongs to the person, not to a course or an academy: `users.is_minor` plus a global `guardian_consents` table. One recorded consent opens every academy the student belongs to.
2. Two ways to record it: **electronic**, where the guardian confirms through a link emailed by Resend (name, relationship, email, time, policy version, IP and browser are kept); and **offline**, where a teacher, assistant or super admin who has seen a signed form records the guardian's name, relationship, the date, a document reference and notes, with who recorded it and in which tenant. Document images are never stored in the database.
3. A student's own checkbox is not consent. Old `memberships.guardian_consent_at` values are copied as `legacy_checkbox` history and do not count.
4. A minor without consent can sign in, but every student content and attempt route answers 403 `GUARDIAN_CONSENT_REQUIRED`: course tree, content links, progress, lesson Q&A, and starting, viewing, answering, submitting and reviewing attempts. Withdrawing consent closes the same routes. Invitations and code redemption never ask for consent; the gate decides.
5. `is_minor` is set when the account is created. After that only the super admin changes it, because a teacher changing it would affect every other academy.
6. Guardian details are visible only to the super admin and to the academy that recorded them; other academies see the status, method and date.

**Consequences:**
- Migration 10R.7 adds `is_minor` and `guardian_consents`, copies old values and marks those people as minors. Nothing is lost; `memberships.guardian_consent_at` stays, no longer written.
- An email confirmation proves that someone controls the guardian's mailbox, not that they are the parent. The offline form is the stronger proof. The lawyer decides what is enough (step 12.6a), and the privacy policy says how documents are kept.
- Consent recorded by one academy opens the others; every recording is audited with its tenant.
- A content link issued before a withdrawal works until it expires (documents 5 minutes, videos 4 hours).
- A new consent email template and public `check` and `confirm` routes are added; the guardian's page is UI and waits for the design.
