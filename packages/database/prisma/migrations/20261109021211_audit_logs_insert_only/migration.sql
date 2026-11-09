-- Audit entries are a permanent record: reject any UPDATE, even from raw SQL.
-- DELETE stays possible only so the 30-day tenant purge can cascade.
CREATE FUNCTION audit_logs_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is insert-only: updates are not allowed';
END;
$$;

CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_update();
