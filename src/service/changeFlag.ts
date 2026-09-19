import type { Db } from '../db/index.js';
import { evaluateFlagChange } from '../domain/flagRules.js';
import type { Environment, FlagAuditEvent, User } from '../domain/types.js';
import {
  FeatureFlagSystemError,
  type FeatureFlagSystem,
} from '../gateway/featureFlagSystem.js';
import {
  applyFlagStateTransition,
  getFeatureFlag,
  getFlagState,
  insertFlagAuditEvent,
  listFlagAuditEvents,
} from '../repo/flags.js';

class StaleFlagChangeError extends Error {}
class NoOpFlagChangeError extends Error {}
class MissingFlagStateError extends Error {}

export type FlagChangeFailure =
  | 'NOT_FOUND'
  | 'FORBIDDEN_ROLE'
  | 'REASON_REQUIRED'
  | 'NO_OP'
  | 'CONFLICT'
  | 'EXTERNAL_FAILURE';

export type FlagChangeOutcome =
  | { ok: true; auditEvent: FlagAuditEvent }
  | { ok: false; failure: FlagChangeFailure; message: string };

export interface FlagChangeInput {
  actor: User;
  flagId: string;
  environment: Environment;
  enabled: boolean;
  reasonNote: string;
}

const FAILURE_MESSAGES: Record<FlagChangeFailure, string> = {
  NOT_FOUND: 'Feature flag not found.',
  FORBIDDEN_ROLE: 'Your role is not permitted to change this flag in this environment.',
  REASON_REQUIRED: 'A reason is required.',
  NO_OP: 'The flag is already in the requested state; nothing was changed.',
  CONFLICT:
    'Another change to this flag landed first. Nothing was changed; reload and try again.',
  EXTERNAL_FAILURE:
    'The feature flag system rejected the change. Nothing was changed; you can retry later.',
};

function fail(failure: FlagChangeFailure): FlagChangeOutcome {
  return { ok: false, failure, message: FAILURE_MESSAGES[failure] };
}

/**
 * Changes a flag's state in one environment.
 *
 * Everything that depends on the stored value happens inside one immediate
 * SQLite transaction, so a concurrent writer cannot change the value between
 * the read and the decision it justifies. The current state is re-read under
 * the write lock: if it already equals the requested value the change is a
 * confirmed no-op and the transaction rolls back without calling the external
 * system or writing an audit event. Otherwise a guarded compare-and-swap keyed
 * on that value runs, the external system is called only once the transition
 * has won, and the single audit insert follows it. If the external call
 * throws, the transaction rolls back and the stored state is untouched.
 *
 * KNOWN LIMITATION: as with the refund gateway, this rollback does not give
 * real consistency between the external feature-flag system and this database.
 * See README "Known production limitations".
 */
export function changeFlag(
  db: Db,
  flagSystem: FeatureFlagSystem,
  input: FlagChangeInput,
): FlagChangeOutcome {
  const flag = getFeatureFlag(db, input.flagId);
  if (!flag) return fail('NOT_FOUND');

  const rules = evaluateFlagChange({
    role: input.actor.role,
    environment: input.environment,
    reasonNote: input.reasonNote,
  });
  if (!rules.ok) return fail(rules.failure);

  const apply = db.transaction((): FlagAuditEvent => {
    const state = getFlagState(db, flag.id, input.environment);
    if (!state) throw new MissingFlagStateError();
    if (state.enabled === input.enabled) throw new NoOpFlagChangeError();

    const changed = applyFlagStateTransition(db, {
      flagId: flag.id,
      environment: input.environment,
      expectedCurrent: state.enabled,
      desired: input.enabled,
      updatedAt: new Date().toISOString(),
    });
    if (!changed) throw new StaleFlagChangeError();

    const { externalRef } = flagSystem.applyFlag({
      flagKey: flag.key,
      environment: input.environment,
      enabled: input.enabled,
    });

    return insertFlagAuditEvent(db, {
      flagId: flag.id,
      environment: input.environment,
      actorUserId: input.actor.id,
      fromEnabled: state.enabled,
      toEnabled: input.enabled,
      reasonNote: input.reasonNote.trim(),
      externalRef,
    });
  });

  try {
    return { ok: true, auditEvent: apply.immediate() };
  } catch (err) {
    if (err instanceof NoOpFlagChangeError) return fail('NO_OP');
    if (err instanceof MissingFlagStateError) return fail('NOT_FOUND');
    if (err instanceof StaleFlagChangeError) return fail('CONFLICT');
    if (err instanceof FeatureFlagSystemError) return fail('EXTERNAL_FAILURE');
    throw err;
  }
}

export { StaleFlagChangeError, listFlagAuditEvents };
