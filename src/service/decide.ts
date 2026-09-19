import type { Db } from '../db/index.js';
import { evaluateDecision } from '../domain/rules.js';
import type { AuditEvent, DecisionAction, User } from '../domain/types.js';
import { RefundGatewayError, type RefundGateway } from '../gateway/refundGateway.js';
import {
  getRefundRequest,
  insertAuditEvent,
  listAuditEvents,
  updateRefundStatus,
} from '../repo/refunds.js';

export type DecisionFailure =
  | 'NOT_FOUND'
  | 'FORBIDDEN_ROLE'
  | 'REASON_REQUIRED'
  | 'NOT_PENDING'
  | 'GATEWAY_FAILURE';

export type DecisionOutcome =
  | { ok: true; auditEvent: AuditEvent }
  | { ok: false; failure: DecisionFailure; message: string };

export interface DecisionInput {
  actor: User;
  refundRequestId: string;
  action: DecisionAction;
  reasonNote: string;
}

const FAILURE_MESSAGES: Record<DecisionFailure, string> = {
  NOT_FOUND: 'Refund request not found.',
  FORBIDDEN_ROLE: 'Your role is not permitted to approve or reject refunds.',
  REASON_REQUIRED: 'A reason is required.',
  NOT_PENDING: 'Only PENDING refund requests can be approved or rejected.',
  GATEWAY_FAILURE:
    'The refund gateway rejected the request. Nothing was changed; you can retry this decision later.',
};

function fail(failure: DecisionFailure): DecisionOutcome {
  return { ok: false, failure, message: FAILURE_MESSAGES[failure] };
}

/**
 * Applies an approve/reject decision.
 *
 * The gateway call, the status change and the single audit insert all happen
 * inside one SQLite transaction: if the gateway throws, the transaction is
 * rolled back, the request stays PENDING and no audit event is written.
 *
 * KNOWN LIMITATION: this rollback does not give real consistency between the
 * external gateway and our database. If the external side effect succeeds but
 * the local commit then fails (process crash, disk error) — or the reverse —
 * the two systems diverge. A production system would need idempotency keys and
 * an outbox/saga plus reconciliation; that is intentionally out of scope for
 * this prototype. See README "Known production limitations".
 */
export function decideRefund(
  db: Db,
  gateway: RefundGateway,
  input: DecisionInput,
): DecisionOutcome {
  const request = getRefundRequest(db, input.refundRequestId);
  if (!request) return fail('NOT_FOUND');

  const rules = evaluateDecision({
    role: input.actor.role,
    currentStatus: request.status,
    action: input.action,
    reasonNote: input.reasonNote,
  });
  if (!rules.ok) return fail(rules.failure);

  const apply = db.transaction((): AuditEvent => {
    const gatewayRef =
      input.action === 'APPROVE' ? gateway.issueRefund(request).gatewayRef : null;
    updateRefundStatus(db, request.id, rules.toStatus);
    return insertAuditEvent(db, {
      refundRequestId: request.id,
      actorUserId: input.actor.id,
      action: input.action,
      fromStatus: request.status,
      toStatus: rules.toStatus,
      reasonNote: input.reasonNote.trim(),
      gatewayRef,
    });
  });

  try {
    return { ok: true, auditEvent: apply() };
  } catch (err) {
    if (err instanceof RefundGatewayError) return fail('GATEWAY_FAILURE');
    throw err;
  }
}

export { listAuditEvents };
