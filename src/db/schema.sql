PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'viewer'))
);

CREATE TABLE IF NOT EXISTS refund_requests (
  id TEXT PRIMARY KEY,
  customer_ref TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  refund_request_id TEXT NOT NULL REFERENCES refund_requests(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('APPROVE', 'REJECT')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason_note TEXT NOT NULL,
  gateway_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_refund_request_id
  ON audit_events (refund_request_id);

-- Audit immutability enforced in the database itself, independent of the
-- application layer: audit rows may only be inserted.
CREATE TRIGGER IF NOT EXISTS audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only: updates are forbidden');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only: deletes are forbidden');
END;
