PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'viewer', 'developer', 'admin'))
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

-- Feature Flag Administration ------------------------------------------------

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flag_states (
  flag_id TEXT NOT NULL REFERENCES feature_flags(id),
  environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (flag_id, environment)
);

CREATE TABLE IF NOT EXISTS flag_audit_events (
  id TEXT PRIMARY KEY,
  flag_id TEXT NOT NULL REFERENCES feature_flags(id),
  environment TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  from_enabled INTEGER NOT NULL,
  to_enabled INTEGER NOT NULL,
  reason_note TEXT NOT NULL,
  external_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flag_audit_events_flag_id
  ON flag_audit_events (flag_id);

-- The flag audit trail gets its own immutability triggers rather than sharing a
-- generic audit table: same guarantee, per-tool columns.
CREATE TRIGGER IF NOT EXISTS flag_audit_events_no_update
BEFORE UPDATE ON flag_audit_events
BEGIN
  SELECT RAISE(ABORT, 'flag_audit_events is append-only: updates are forbidden');
END;

CREATE TRIGGER IF NOT EXISTS flag_audit_events_no_delete
BEFORE DELETE ON flag_audit_events
BEGIN
  SELECT RAISE(ABORT, 'flag_audit_events is append-only: deletes are forbidden');
END;
