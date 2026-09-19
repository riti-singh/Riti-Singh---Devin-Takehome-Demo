import type { RefundRequest } from '../domain/types.js';

export interface GatewayResult {
  gatewayRef: string;
}

export interface RefundGateway {
  issueRefund(request: RefundRequest): GatewayResult;
}

export class RefundGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundGatewayError';
  }
}

/** Synthetic customer reference that makes the mock gateway fail deterministically. */
export const GATEWAY_FAILURE_CUSTOMER_REF = 'CUST-GATEWAY-FAIL';

export class MockRefundGateway implements RefundGateway {
  issueRefund(request: RefundRequest): GatewayResult {
    if (request.customerRef === GATEWAY_FAILURE_CUSTOMER_REF) {
      throw new RefundGatewayError(`gateway declined refund for ${request.id}`);
    }
    return { gatewayRef: `mock_gw_${request.id}` };
  }
}
