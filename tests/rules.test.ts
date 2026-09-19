import { describe, expect, it } from 'vitest';
import { canTransition, evaluateDecision, isReasonValid, targetStatus } from '../src/domain/rules.js';

describe('decision rules', () => {
  it('requires a non-empty reason for approve and reject', () => {
    expect(isReasonValid('')).toBe(false);
    expect(isReasonValid('   ')).toBe(false);
    expect(isReasonValid(undefined)).toBe(false);
    expect(isReasonValid('duplicate charge confirmed')).toBe(true);

    for (const action of ['APPROVE', 'REJECT'] as const) {
      expect(
        evaluateDecision({ role: 'reviewer', currentStatus: 'PENDING', action, reasonNote: '  ' }),
      ).toEqual({ ok: false, failure: 'REASON_REQUIRED' });
    }
  });

  it('only allows decisions on PENDING requests', () => {
    expect(canTransition('PENDING', 'APPROVE')).toBe(true);
    expect(canTransition('PENDING', 'REJECT')).toBe(true);
    expect(canTransition('APPROVED', 'REJECT')).toBe(false);
    expect(canTransition('REJECTED', 'APPROVE')).toBe(false);

    expect(
      evaluateDecision({
        role: 'reviewer',
        currentStatus: 'APPROVED',
        action: 'REJECT',
        reasonNote: 'changed my mind',
      }),
    ).toEqual({ ok: false, failure: 'NOT_PENDING' });
  });

  it('blocks viewers from deciding', () => {
    expect(
      evaluateDecision({
        role: 'viewer',
        currentStatus: 'PENDING',
        action: 'APPROVE',
        reasonNote: 'looks fine',
      }),
    ).toEqual({ ok: false, failure: 'FORBIDDEN_ROLE' });
  });

  it('maps actions to target statuses', () => {
    expect(targetStatus('APPROVE')).toBe('APPROVED');
    expect(targetStatus('REJECT')).toBe('REJECTED');
    expect(
      evaluateDecision({
        role: 'reviewer',
        currentStatus: 'PENDING',
        action: 'APPROVE',
        reasonNote: 'verified',
      }),
    ).toEqual({ ok: true, toStatus: 'APPROVED' });
  });
});
