import { describe, expect, it } from 'vitest';
import type { RefundRequest } from '../src/domain/types.js';
import {
  GATEWAY_FAILURE_CUSTOMER_REF,
  MockRefundGateway,
  RefundGatewayError,
} from '../src/gateway/refundGateway.js';

const request = (over: Partial<RefundRequest> = {}): RefundRequest => ({
  id: 'rr-1001',
  customerRef: 'CUST-0001',
  amountCents: 1000,
  reason: 'test',
  status: 'PENDING',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('MockRefundGateway', () => {
  it('returns a stable gatewayRef for a given request id', () => {
    const gateway = new MockRefundGateway();
    const first = gateway.issueRefund(request());
    const second = new MockRefundGateway().issueRefund(request({ amountCents: 9999 }));

    expect(first.gatewayRef).toBe('mock_gw_rr-1001');
    expect(second.gatewayRef).toBe(first.gatewayRef);
    expect(gateway.issueRefund(request({ id: 'rr-1002' })).gatewayRef).toBe('mock_gw_rr-1002');
  });

  it('fails deterministically for the designated synthetic input', () => {
    const gateway = new MockRefundGateway();
    const failing = request({ id: 'rr-1005', customerRef: GATEWAY_FAILURE_CUSTOMER_REF });
    expect(() => gateway.issueRefund(failing)).toThrow(RefundGatewayError);
    expect(() => gateway.issueRefund(failing)).toThrow(RefundGatewayError);
  });
});
