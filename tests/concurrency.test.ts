import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/index.js';
import { resetAndSeed } from '../src/db/seed.js';
import type { RefundRequest } from '../src/domain/types.js';
import { MockRefundGateway, type RefundGateway } from '../src/gateway/refundGateway.js';
import { claimPendingRefund, getRefundRequest, getUser, listAuditEvents } from '../src/repo/refunds.js';
import { decideRefund } from '../src/service/decide.js';

let dir: string;
let file: string;
let a: Db;
let b: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'refund-ops-'));
  file = join(dir, 'refunds.db');
  resetAndSeed(file).close();
  a = openDb(file);
  b = openDb(file);
});

afterEach(() => {
  a.close();
  b.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('concurrent decisions on the same request', () => {
  it('lets only one connection claim a PENDING request', () => {
    expect(claimPendingRefund(a, 'rr-1001', 'APPROVED')).toBe(true);
    expect(claimPendingRefund(b, 'rr-1001', 'REJECTED')).toBe(false);
    expect(getRefundRequest(b, 'rr-1001')!.status).toBe('APPROVED');
  });

  it('leaves a second reviewer on another connection with NOT_PENDING, one audit event and one gateway call', () => {
    const reviewer = getUser(a, 'user-reviewer')!;
    const calls: string[] = [];
    const countingGateway: RefundGateway = {
      issueRefund(request: RefundRequest) {
        calls.push(request.id);
        return new MockRefundGateway().issueRefund(request);
      },
    };

    // Connection B reads the request as PENDING before A decides it.
    const staleRequest = getRefundRequest(b, 'rr-1001')!;
    expect(staleRequest.status).toBe('PENDING');

    expect(
      decideRefund(a, countingGateway, {
        actor: reviewer,
        refundRequestId: 'rr-1001',
        action: 'APPROVE',
        reasonNote: 'first reviewer wins',
      }).ok,
    ).toBe(true);

    const second = decideRefund(b, countingGateway, {
      actor: getUser(b, 'user-reviewer-2')!,
      refundRequestId: 'rr-1001',
      action: 'REJECT',
      reasonNote: 'second reviewer loses the race',
    });

    expect(second).toMatchObject({ ok: false, failure: 'NOT_PENDING' });
    expect(getRefundRequest(b, 'rr-1001')!.status).toBe('APPROVED');
    expect(listAuditEvents(b, 'rr-1001')).toHaveLength(1);
    expect(calls).toEqual(['rr-1001']);
  });
});
