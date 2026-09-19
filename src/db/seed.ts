import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from './index.js';
import { createDb } from './index.js';
import { insertRefundRequest, insertUser } from '../repo/refunds.js';
import { insertFeatureFlag, insertFlagState } from '../repo/flags.js';
import type { FeatureFlag, FeatureFlagState, RefundRequest, User } from '../domain/types.js';
import { GATEWAY_FAILURE_CUSTOMER_REF } from '../gateway/refundGateway.js';
import { FLAG_APPLY_FAILURE_KEY } from '../gateway/featureFlagSystem.js';

/** Synthetic users; no real PII. */
export const SEED_USERS: User[] = [
  { id: 'user-reviewer', name: 'Rhea Reviewer', role: 'reviewer' },
  { id: 'user-reviewer-2', name: 'Raj Reviewer', role: 'reviewer' },
  { id: 'user-viewer', name: 'Vic Viewer', role: 'viewer' },
  { id: 'user-developer', name: 'Dev Developer', role: 'developer' },
  { id: 'user-developer-2', name: 'Dana Developer', role: 'developer' },
  { id: 'user-admin', name: 'Ada Admin', role: 'admin' },
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

/** Synthetic feature flags; no real PII. */
export const SEED_FEATURE_FLAGS: FeatureFlag[] = [
  {
    id: 'ff-checkout-v2',
    key: 'checkout-v2',
    description: 'New checkout flow',
    createdAt: '2026-01-04T09:00:00.000Z',
  },
  {
    id: 'ff-bulk-refunds',
    key: 'bulk-refunds',
    description: 'Bulk refund actions in the refund queue',
    createdAt: '2026-01-04T09:05:00.000Z',
  },
  {
    id: 'ff-dark-mode',
    key: 'dark-mode',
    description: 'Dark colour scheme for internal tools',
    createdAt: '2026-01-04T09:10:00.000Z',
  },
  {
    id: 'ff-apply-fail',
    key: FLAG_APPLY_FAILURE_KEY,
    description: 'External-failure rehearsal case (mock system always declines)',
    createdAt: '2026-01-04T09:15:00.000Z',
  },
];

/** Every seeded flag has a state in both fixed environments. */
export const SEED_FLAG_STATES: FeatureFlagState[] = [
  { flagId: 'ff-checkout-v2', environment: 'development', enabled: true, updatedAt: '2026-01-04T09:00:00.000Z' },
  { flagId: 'ff-checkout-v2', environment: 'production', enabled: false, updatedAt: '2026-01-04T09:00:00.000Z' },
  { flagId: 'ff-bulk-refunds', environment: 'development', enabled: false, updatedAt: '2026-01-04T09:05:00.000Z' },
  { flagId: 'ff-bulk-refunds', environment: 'production', enabled: false, updatedAt: '2026-01-04T09:05:00.000Z' },
  { flagId: 'ff-dark-mode', environment: 'development', enabled: true, updatedAt: '2026-01-04T09:10:00.000Z' },
  { flagId: 'ff-dark-mode', environment: 'production', enabled: true, updatedAt: '2026-01-04T09:10:00.000Z' },
  { flagId: 'ff-apply-fail', environment: 'development', enabled: false, updatedAt: '2026-01-04T09:15:00.000Z' },
  { flagId: 'ff-apply-fail', environment: 'production', enabled: false, updatedAt: '2026-01-04T09:15:00.000Z' },
];

export function seed(db: Db): void {
  const run = db.transaction(() => {
    for (const user of SEED_USERS) insertUser(db, user);
    for (const refund of SEED_REFUNDS) insertRefundRequest(db, refund);
    for (const flag of SEED_FEATURE_FLAGS) insertFeatureFlag(db, flag);
    for (const state of SEED_FLAG_STATES) insertFlagState(db, state);
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
  console.log(
    `Seeded ${file} with ${SEED_USERS.length} users, ${SEED_REFUNDS.length} refund requests and ${SEED_FEATURE_FLAGS.length} feature flags.`,
  );
}
