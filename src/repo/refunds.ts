import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import type { AuditEvent, RefundRequest, RefundStatus, User } from '../domain/types.js';

interface RefundRow {
  id: string;
  customer_ref: string;
  amount_cents: number;
  reason: string;
  status: RefundStatus;
  created_at: string;
}

interface AuditRow {
  id: string;
  refund_request_id: string;
  actor_user_id: string;
  action: 'APPROVE' | 'REJECT';
  from_status: RefundStatus;
  to_status: RefundStatus;
  reason_note: string;
  gateway_ref: string | null;
  created_at: string;
}

function toRefund(row: RefundRow): RefundRequest {
  return {
    id: row.id,
    customerRef: row.customer_ref,
    amountCents: row.amount_cents,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toAudit(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    refundRequestId: row.refund_request_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reasonNote: row.reason_note,
    gatewayRef: row.gateway_ref,
    createdAt: row.created_at,
  };
}

export function listUsers(db: Db): User[] {
  return db.prepare('SELECT id, name, role FROM users ORDER BY name').all() as User[];
}

export function getUser(db: Db, id: string): User | undefined {
  return db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(id) as User | undefined;
}

export function listRefundRequests(db: Db): RefundRequest[] {
  const rows = db
    .prepare(
      `SELECT * FROM refund_requests
       ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END, created_at DESC`,
    )
    .all() as RefundRow[];
  return rows.map(toRefund);
}

export function getRefundRequest(db: Db, id: string): RefundRequest | undefined {
  const row = db.prepare('SELECT * FROM refund_requests WHERE id = ?').get(id) as
    | RefundRow
    | undefined;
  return row ? toRefund(row) : undefined;
}

export function listAuditEvents(db: Db, refundRequestId: string): AuditEvent[] {
  const rows = db
    .prepare('SELECT * FROM audit_events WHERE refund_request_id = ? ORDER BY created_at, id')
    .all(refundRequestId) as AuditRow[];
  return rows.map(toAudit);
}

export function insertRefundRequest(db: Db, request: RefundRequest): void {
  db.prepare(
    `INSERT INTO refund_requests (id, customer_ref, amount_cents, reason, status, created_at)
     VALUES (@id, @customerRef, @amountCents, @reason, @status, @createdAt)`,
  ).run(request);
}

export function insertUser(db: Db, user: User): void {
  db.prepare('INSERT INTO users (id, name, role) VALUES (@id, @name, @role)').run(user);
}

/** Audit events are append-only: this insert is the only audit write path. */
export function insertAuditEvent(
  db: Db,
  event: Omit<AuditEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
): AuditEvent {
  const row: AuditEvent = {
    id: event.id ?? randomUUID(),
    refundRequestId: event.refundRequestId,
    actorUserId: event.actorUserId,
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    reasonNote: event.reasonNote,
    gatewayRef: event.gatewayRef,
    createdAt: event.createdAt ?? new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO audit_events
       (id, refund_request_id, actor_user_id, action, from_status, to_status, reason_note, gateway_ref, created_at)
     VALUES
       (@id, @refundRequestId, @actorUserId, @action, @fromStatus, @toStatus, @reasonNote, @gatewayRef, @createdAt)`,
  ).run(row);
  return row;
}

/**
 * Moves a request out of PENDING, returning false if it is no longer PENDING.
 * The status guard lives in the UPDATE itself so two concurrent decisions on
 * the same request cannot both win.
 */
export function claimPendingRefund(db: Db, id: string, status: RefundStatus): boolean {
  const result = db
    .prepare("UPDATE refund_requests SET status = ? WHERE id = ? AND status = 'PENDING'")
    .run(status, id);
  return result.changes === 1;
}
