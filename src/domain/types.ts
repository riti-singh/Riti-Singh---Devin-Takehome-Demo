export type Role = 'reviewer' | 'viewer';

export type RefundStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type DecisionAction = 'APPROVE' | 'REJECT';

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface RefundRequest {
  id: string;
  customerRef: string;
  amountCents: number;
  reason: string;
  status: RefundStatus;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  refundRequestId: string;
  actorUserId: string;
  action: DecisionAction;
  fromStatus: RefundStatus;
  toStatus: RefundStatus;
  reasonNote: string;
  gatewayRef: string | null;
  createdAt: string;
}
