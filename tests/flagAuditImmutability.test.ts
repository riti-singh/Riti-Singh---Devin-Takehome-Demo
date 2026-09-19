import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import { MockFeatureFlagSystem } from '../src/gateway/featureFlagSystem.js';
import { listFlagAuditEvents } from '../src/repo/flags.js';
import { getUser } from '../src/repo/refunds.js';
import { changeFlag } from '../src/service/changeFlag.js';
import { freshDb } from './helpers.js';

let db: Db;

beforeEach(() => {
  db = freshDb();
  changeFlag(db, new MockFeatureFlagSystem(), {
    actor: getUser(db, 'user-admin')!,
    flagId: 'ff-checkout-v2',
    environment: 'production',
    enabled: true,
    reasonNote: 'rollout approved',
  });
});
afterEach(() => db.close());

describe('flag_audit_events immutability triggers', () => {
  it('rejects a direct UPDATE against the flag audit table', () => {
    expect(() =>
      db
        .prepare("UPDATE flag_audit_events SET reason_note = 'tampered' WHERE flag_id = ?")
        .run('ff-checkout-v2'),
    ).toThrow(/append-only/);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')[0].reasonNote).toBe('rollout approved');
  });

  it('rejects a direct DELETE against the flag audit table', () => {
    expect(() =>
      db.prepare('DELETE FROM flag_audit_events WHERE flag_id = ?').run('ff-checkout-v2'),
    ).toThrow(/append-only/);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')).toHaveLength(1);
  });
});
