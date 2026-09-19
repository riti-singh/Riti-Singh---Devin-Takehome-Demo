export type Role = 'reviewer' | 'viewer' | 'developer' | 'admin';

export type Environment = 'development' | 'production';

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

export interface FeatureFlag {
  id: string;
  key: string;
  description: string;
  createdAt: string;
}

export interface FeatureFlagState {
  flagId: string;
  environment: Environment;
  enabled: boolean;
  updatedAt: string;
}

export interface FlagAuditEvent {
  id: string;
  flagId: string;
  environment: Environment;
  actorUserId: string;
  fromEnabled: boolean;
  toEnabled: boolean;
  reasonNote: string;
  externalRef: string | null;
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
