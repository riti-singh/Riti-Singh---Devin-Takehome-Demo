import type { DecisionAction, RefundStatus, Role } from './types.js';

export type RuleFailure =
  | 'REASON_REQUIRED'
  | 'NOT_PENDING'
  | 'FORBIDDEN_ROLE';

export type RuleResult =
  | { ok: true; toStatus: RefundStatus }
  | { ok: false; failure: RuleFailure };

export function isReasonValid(reasonNote: string | undefined | null): boolean {
  return typeof reasonNote === 'string' && reasonNote.trim().length > 0;
}

export function canTransition(from: RefundStatus, action: DecisionAction): boolean {
  return from === 'PENDING' && (action === 'APPROVE' || action === 'REJECT');
}

export function targetStatus(action: DecisionAction): RefundStatus {
  return action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
}

export function canDecide(role: Role): boolean {
  return role === 'reviewer';
}

export function evaluateDecision(input: {
  role: Role;
  currentStatus: RefundStatus;
  action: DecisionAction;
  reasonNote: string | undefined | null;
}): RuleResult {
  if (!canDecide(input.role)) return { ok: false, failure: 'FORBIDDEN_ROLE' };
  if (!isReasonValid(input.reasonNote)) return { ok: false, failure: 'REASON_REQUIRED' };
  if (!canTransition(input.currentStatus, input.action)) return { ok: false, failure: 'NOT_PENDING' };
  return { ok: true, toStatus: targetStatus(input.action) };
}
