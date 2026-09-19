import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { MockRefundGateway } from '../src/gateway/refundGateway.js';
import { getUser, listAuditEvents } from '../src/repo/refunds.js';
import { decideRefund } from '../src/service/decide.js';
import { freshDb } from './helpers.js';

let db: Db;

beforeEach(() => {
  db = freshDb();
  decideRefund(db, new MockRefundGateway(), {
    actor: getUser(db, 'user-reviewer')!,
    refundRequestId: 'rr-1001',
    action: 'APPROVE',
    reasonNote: 'verified',
  });
});
afterEach(() => db.close());

describe('audit_events immutability triggers', () => {
  it('rejects a direct UPDATE against the audit table', () => {
    expect(() =>
      db.prepare("UPDATE audit_events SET reason_note = 'tampered' WHERE refund_request_id = ?").run('rr-1001'),
    ).toThrow(/append-only/);
    expect(listAuditEvents(db, 'rr-1001')[0].reasonNote).toBe('verified');
  });

  it('rejects a direct DELETE against the audit table', () => {
    expect(() => db.prepare('DELETE FROM audit_events WHERE refund_request_id = ?').run('rr-1001')).toThrow(
      /append-only/,
    );
    expect(listAuditEvents(db, 'rr-1001')).toHaveLength(1);
  });
});
