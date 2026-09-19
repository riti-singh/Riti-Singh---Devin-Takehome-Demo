import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { MockRefundGateway } from '../src/gateway/refundGateway.js';
import { getRefundRequest, getUser, listAuditEvents } from '../src/repo/refunds.js';
import { decideRefund } from '../src/service/decide.js';
import { freshDb } from './helpers.js';

let db: Db;
const gateway = new MockRefundGateway();

const reviewer = () => getUser(db, 'user-reviewer')!;
const viewer = () => getUser(db, 'user-viewer')!;

beforeEach(() => {
  db = freshDb();
});
afterEach(() => db.close());

describe('decideRefund', () => {
  it('approves a pending request and writes exactly one audit event with the gateway ref', () => {
    const outcome = decideRefund(db, gateway, {
      actor: reviewer(),
      refundRequestId: 'rr-1001',
      action: 'APPROVE',
      reasonNote: 'damage photos verified',
    });

    expect(outcome.ok).toBe(true);
    expect(getRefundRequest(db, 'rr-1001')!.status).toBe('APPROVED');

    const events = listAuditEvents(db, 'rr-1001');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: 'user-reviewer',
      action: 'APPROVE',
      fromStatus: 'PENDING',
      toStatus: 'APPROVED',
      reasonNote: 'damage photos verified',
      gatewayRef: 'mock_gw_rr-1001',
    });
    expect(events[0].createdAt).toBeTruthy();
  });

  it('rejects a pending request and writes exactly one audit event', () => {
    const outcome = decideRefund(db, gateway, {
      actor: reviewer(),
      refundRequestId: 'rr-1002',
      action: 'REJECT',
      reasonNote: 'charge is legitimate',
    });

    expect(outcome.ok).toBe(true);
    expect(getRefundRequest(db, 'rr-1002')!.status).toBe('REJECTED');
    const events = listAuditEvents(db, 'rr-1002');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'REJECT', toStatus: 'REJECTED', gatewayRef: null });
  });

  it('requires a reason and changes nothing without one', () => {
    const outcome = decideRefund(db, gateway, {
      actor: reviewer(),
      refundRequestId: 'rr-1001',
      action: 'APPROVE',
      reasonNote: '   ',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'REASON_REQUIRED' });
    expect(getRefundRequest(db, 'rr-1001')!.status).toBe('PENDING');
    expect(listAuditEvents(db, 'rr-1001')).toHaveLength(0);
  });

  it('refuses to act on a request that is not PENDING', () => {
    const outcome = decideRefund(db, gateway, {
      actor: reviewer(),
      refundRequestId: 'rr-1007',
      action: 'REJECT',
      reasonNote: 'second look',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'NOT_PENDING' });
    expect(getRefundRequest(db, 'rr-1007')!.status).toBe('REJECTED');
    expect(listAuditEvents(db, 'rr-1007')).toHaveLength(0);
  });

  it('blocks viewers with no state change and no audit write', () => {
    const outcome = decideRefund(db, gateway, {
      actor: viewer(),
      refundRequestId: 'rr-1001',
      action: 'APPROVE',
      reasonNote: 'looks fine to me',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'FORBIDDEN_ROLE' });
    expect(getRefundRequest(db, 'rr-1001')!.status).toBe('PENDING');
    expect(listAuditEvents(db, 'rr-1001')).toHaveLength(0);
  });

  it('rolls back completely when the gateway fails, leaving the request PENDING', () => {
    const outcome = decideRefund(db, gateway, {
      actor: reviewer(),
      refundRequestId: 'rr-1005',
      action: 'APPROVE',
      reasonNote: 'approving the rehearsal case',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'GATEWAY_FAILURE' });
    expect(getRefundRequest(db, 'rr-1005')!.status).toBe('PENDING');
    expect(listAuditEvents(db, 'rr-1005')).toHaveLength(0);

    const retry = decideRefund(db, gateway, {
      actor: reviewer(),
      refundRequestId: 'rr-1005',
      action: 'REJECT',
      reasonNote: 'retrying with a reject instead',
    });
    expect(retry.ok).toBe(true);
    expect(getRefundRequest(db, 'rr-1005')!.status).toBe('REJECTED');
  });

  it('returns NOT_FOUND for unknown requests', () => {
    expect(
      decideRefund(db, gateway, {
        actor: reviewer(),
        refundRequestId: 'rr-nope',
        action: 'APPROVE',
        reasonNote: 'x',
      }),
    ).toMatchObject({ ok: false, failure: 'NOT_FOUND' });
  });
});
