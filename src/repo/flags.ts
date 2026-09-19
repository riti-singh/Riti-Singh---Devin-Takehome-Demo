import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import type {
  Environment,
  FeatureFlag,
  FeatureFlagState,
  FlagAuditEvent,
} from '../domain/types.js';

interface FlagRow {
  id: string;
  key: string;
  description: string;
  created_at: string;
}

interface FlagStateRow {
  flag_id: string;
  environment: Environment;
  enabled: number;
  updated_at: string;
}

interface FlagAuditRow {
  id: string;
  flag_id: string;
  environment: Environment;
  actor_user_id: string;
  from_enabled: number;
  to_enabled: number;
  reason_note: string;
  external_ref: string | null;
  created_at: string;
}

function toFlag(row: FlagRow): FeatureFlag {
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    createdAt: row.created_at,
  };
}

function toState(row: FlagStateRow): FeatureFlagState {
  return {
    flagId: row.flag_id,
    environment: row.environment,
    enabled: row.enabled === 1,
    updatedAt: row.updated_at,
  };
}

function toFlagAudit(row: FlagAuditRow): FlagAuditEvent {
  return {
    id: row.id,
    flagId: row.flag_id,
    environment: row.environment,
    actorUserId: row.actor_user_id,
    fromEnabled: row.from_enabled === 1,
    toEnabled: row.to_enabled === 1,
    reasonNote: row.reason_note,
    externalRef: row.external_ref,
    createdAt: row.created_at,
  };
}

export function listFeatureFlags(db: Db): FeatureFlag[] {
  const rows = db.prepare('SELECT * FROM feature_flags ORDER BY key').all() as FlagRow[];
  return rows.map(toFlag);
}

export function getFeatureFlag(db: Db, id: string): FeatureFlag | undefined {
  const row = db.prepare('SELECT * FROM feature_flags WHERE id = ?').get(id) as FlagRow | undefined;
  return row ? toFlag(row) : undefined;
}

export function getFlagState(
  db: Db,
  flagId: string,
  environment: Environment,
): FeatureFlagState | undefined {
  const row = db
    .prepare('SELECT * FROM feature_flag_states WHERE flag_id = ? AND environment = ?')
    .get(flagId, environment) as FlagStateRow | undefined;
  return row ? toState(row) : undefined;
}

export function listFlagStates(db: Db, flagId: string): FeatureFlagState[] {
  const rows = db
    .prepare('SELECT * FROM feature_flag_states WHERE flag_id = ? ORDER BY environment')
    .all(flagId) as FlagStateRow[];
  return rows.map(toState);
}

export function listFlagAuditEvents(db: Db, flagId: string): FlagAuditEvent[] {
  const rows = db
    .prepare('SELECT * FROM flag_audit_events WHERE flag_id = ? ORDER BY created_at, id')
    .all(flagId) as FlagAuditRow[];
  return rows.map(toFlagAudit);
}

export function insertFeatureFlag(db: Db, flag: FeatureFlag): void {
  db.prepare(
    `INSERT INTO feature_flags (id, key, description, created_at)
     VALUES (@id, @key, @description, @createdAt)`,
  ).run(flag);
}

export function insertFlagState(db: Db, state: FeatureFlagState): void {
  db.prepare(
    `INSERT INTO feature_flag_states (flag_id, environment, enabled, updated_at)
     VALUES (@flagId, @environment, @enabled, @updatedAt)`,
  ).run({ ...state, enabled: state.enabled ? 1 : 0 });
}

/** Flag audit events are append-only: this insert is the only audit write path. */
export function insertFlagAuditEvent(
  db: Db,
  event: Omit<FlagAuditEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): FlagAuditEvent {
  const row: FlagAuditEvent = {
    id: event.id ?? randomUUID(),
    flagId: event.flagId,
    environment: event.environment,
    actorUserId: event.actorUserId,
    fromEnabled: event.fromEnabled,
    toEnabled: event.toEnabled,
    reasonNote: event.reasonNote,
    externalRef: event.externalRef,
    createdAt: event.createdAt ?? new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO flag_audit_events
       (id, flag_id, environment, actor_user_id, from_enabled, to_enabled, reason_note, external_ref, created_at)
     VALUES
       (@id, @flagId, @environment, @actorUserId, @fromEnabled, @toEnabled, @reasonNote, @externalRef, @createdAt)`,
  ).run({
    ...row,
    fromEnabled: row.fromEnabled ? 1 : 0,
    toEnabled: row.toEnabled ? 1 : 0,
  });
  return row;
}

/**
 * Compare-and-swap on a flag's per-environment state, returning false when the
 * stored value no longer matches the value the caller read a moment earlier.
 * The guard lives in the UPDATE itself so two concurrent writers cannot both win.
 */
export function applyFlagStateTransition(
  db: Db,
  input: {
    flagId: string;
    environment: Environment;
    expectedCurrent: boolean;
    desired: boolean;
    updatedAt: string;
  },
): boolean {
  const result = db
    .prepare(
      `UPDATE feature_flag_states SET enabled = @desired, updated_at = @updatedAt
       WHERE flag_id = @flagId AND environment = @environment AND enabled = @expectedCurrent`,
    )
    .run({
      flagId: input.flagId,
      environment: input.environment,
      expectedCurrent: input.expectedCurrent ? 1 : 0,
      desired: input.desired ? 1 : 0,
      updatedAt: input.updatedAt,
    });
  return result.changes === 1;
}
