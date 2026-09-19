import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from './index.js';
import { createDb } from './index.js';
import { insertRefundRequest, insertUser } from '../repo/refunds.js';
import type { RefundRequest, User } from '../domain/types.js';
import { GATEWAY_FAILURE_CUSTOMER_REF } from '../gateway/refundGateway.js';

/** Synthetic users; no real PII. */
export const SEED_USERS: User[] = [
  { id: 'user-reviewer', name: 'Rhea Reviewer', role: 'reviewer' },
  { id: 'user-reviewer-2', name: 'Raj Reviewer', role: 'reviewer' },
  { id: 'user-viewer', name: 'Vic Viewer', role: 'viewer' },
];

/** Synthetic refund requests; no real PII. */
export const SEED_REFUNDS: RefundRequest[] = [
  {
    id: 'rr-1001',
    customerRef: 'CUST-0001',
    amountCents: 2599,
    reason: 'Item arrived damaged',
    status: 'PENDING',
    createdAt: '2026-01-05T10:00:00.000Z',
  },
  {
    id: 'rr-1002',
    customerRef: 'CUST-0002',
    amountCents: 14900,
    reason: 'Duplicate charge',
    status: 'PENDING',
    createdAt: '2026-01-05T11:30:00.000Z',
  },
  {
    id: 'rr-1003',
    customerRef: 'CUST-0003',
    amountCents: 4200,
    reason: 'Never received order',
    status: 'PENDING',
    createdAt: '2026-01-06T09:15:00.000Z',
  },
  {
    id: 'rr-1004',
    customerRef: 'CUST-0004',
    amountCents: 999,
    reason: 'Subscription cancelled late',
    status: 'PENDING',
    createdAt: '2026-01-06T12:45:00.000Z',
  },
  {
    id: 'rr-1005',
    customerRef: GATEWAY_FAILURE_CUSTOMER_REF,
    amountCents: 7350,
    reason: 'Gateway rehearsal case (mock gateway always declines)',
    status: 'PENDING',
    createdAt: '2026-01-07T08:05:00.000Z',
  },
  {
    id: 'rr-1006',
    customerRef: 'CUST-0006',
    amountCents: 31000,
    reason: 'Wrong size shipped',
    status: 'APPROVED',
    createdAt: '2026-01-02T14:20:00.000Z',
  },
  {
    id: 'rr-1007',
    customerRef: 'CUST-0007',
    amountCents: 1250,
    reason: 'Changed mind after window closed',
    status: 'REJECTED',
    createdAt: '2026-01-03T16:40:00.000Z',
  },
];

export function seed(db: Db): void {
  const run = db.transaction(() => {
    for (const user of SEED_USERS) insertUser(db, user);
    for (const refund of SEED_REFUNDS) insertRefundRequest(db, refund);
  });
  run();
}

export function resetAndSeed(file: string): Db {
  mkdirSync(dirname(file), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  const db = createDb(file);
  seed(db);
  return db;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const file = process.env.DATABASE_FILE ?? 'data/refunds.db';
  const db = resetAndSeed(file);
  db.close();
  console.log(`Seeded ${file} with ${SEED_USERS.length} users and ${SEED_REFUNDS.length} refund requests.`);
}
