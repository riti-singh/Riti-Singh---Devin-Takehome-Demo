import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/index.js';
import {
  MockFeatureFlagSystem,
  type FeatureFlagApplyInput,
  type FeatureFlagSystem,
} from '../src/gateway/featureFlagSystem.js';
import { getFlagState, listFlagAuditEvents } from '../src/repo/flags.js';
import { getUser } from '../src/repo/refunds.js';
import { changeFlag } from '../src/service/changeFlag.js';
import { freshDb } from './helpers.js';

let db: Db;
const flagSystem = new MockFeatureFlagSystem();

const developer = () => getUser(db, 'user-developer')!;
const admin = () => getUser(db, 'user-admin')!;
const viewer = () => getUser(db, 'user-viewer')!;

function countingFlagSystem(): { system: FeatureFlagSystem; calls: FeatureFlagApplyInput[] } {
  const calls: FeatureFlagApplyInput[] = [];
  return {
    calls,
    system: {
      applyFlag(input: FeatureFlagApplyInput) {
        calls.push(input);
        return flagSystem.applyFlag(input);
      },
    },
  };
}

beforeEach(() => {
  db = freshDb();
});
afterEach(() => db.close());

describe('changeFlag', () => {
  it('lets a developer enable a development flag and writes exactly one audit event', () => {
    const outcome = changeFlag(db, flagSystem, {
      actor: developer(),
      flagId: 'ff-bulk-refunds',
      environment: 'development',
      enabled: true,
      reasonNote: 'testing the bulk path',
    });

    expect(outcome.ok).toBe(true);
    expect(getFlagState(db, 'ff-bulk-refunds', 'development')!.enabled).toBe(true);

    const events = listFlagAuditEvents(db, 'ff-bulk-refunds');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: 'user-developer',
      environment: 'development',
      fromEnabled: false,
      toEnabled: true,
      reasonNote: 'testing the bulk path',
      externalRef: 'mock_ff_bulk-refunds_development',
    });
    expect(getFlagState(db, 'ff-bulk-refunds', 'production')!.enabled).toBe(false);
  });

  it('lets an admin change a production flag', () => {
    const outcome = changeFlag(db, flagSystem, {
      actor: admin(),
      flagId: 'ff-checkout-v2',
      environment: 'production',
      enabled: true,
      reasonNote: 'rollout approved',
    });

    expect(outcome.ok).toBe(true);
    expect(getFlagState(db, 'ff-checkout-v2', 'production')!.enabled).toBe(true);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')).toHaveLength(1);
  });

  it('blocks a developer on production with no state change and no audit write', () => {
    const { system, calls } = countingFlagSystem();
    const outcome = changeFlag(db, system, {
      actor: developer(),
      flagId: 'ff-checkout-v2',
      environment: 'production',
      enabled: true,
      reasonNote: 'shipping it anyway',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'FORBIDDEN_ROLE' });
    expect(getFlagState(db, 'ff-checkout-v2', 'production')!.enabled).toBe(false);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('blocks roles from the other tool entirely', () => {
    expect(
      changeFlag(db, flagSystem, {
        actor: viewer(),
        flagId: 'ff-bulk-refunds',
        environment: 'development',
        enabled: true,
        reasonNote: 'looks fine to me',
      }),
    ).toMatchObject({ ok: false, failure: 'FORBIDDEN_ROLE' });
    expect(listFlagAuditEvents(db, 'ff-bulk-refunds')).toHaveLength(0);
  });

  it('requires a reason and changes nothing without one', () => {
    const outcome = changeFlag(db, flagSystem, {
      actor: admin(),
      flagId: 'ff-checkout-v2',
      environment: 'production',
      enabled: true,
      reasonNote: '   ',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'REASON_REQUIRED' });
    expect(getFlagState(db, 'ff-checkout-v2', 'production')!.enabled).toBe(false);
    expect(listFlagAuditEvents(db, 'ff-checkout-v2')).toHaveLength(0);
  });

  it('treats setting the current value as a NO_OP: no external call, no audit event', () => {
    const { system, calls } = countingFlagSystem();
    const before = getFlagState(db, 'ff-dark-mode', 'development')!;

    const outcome = changeFlag(db, system, {
      actor: developer(),
      flagId: 'ff-dark-mode',
      environment: 'development',
      enabled: true,
      reasonNote: 'already on',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'NO_OP' });
    expect(calls).toHaveLength(0);
    expect(listFlagAuditEvents(db, 'ff-dark-mode')).toHaveLength(0);
    expect(getFlagState(db, 'ff-dark-mode', 'development')).toEqual(before);
  });

  it('rolls back completely when the external system fails', () => {
    const outcome = changeFlag(db, flagSystem, {
      actor: developer(),
      flagId: 'ff-apply-fail',
      environment: 'development',
      enabled: true,
      reasonNote: 'rehearsing the failure path',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'EXTERNAL_FAILURE' });
    expect(getFlagState(db, 'ff-apply-fail', 'development')!.enabled).toBe(false);
    expect(listFlagAuditEvents(db, 'ff-apply-fail')).toHaveLength(0);
  });

  it('returns NOT_FOUND for unknown flags', () => {
    expect(
      changeFlag(db, flagSystem, {
        actor: admin(),
        flagId: 'ff-nope',
        environment: 'development',
        enabled: true,
        reasonNote: 'x',
      }),
    ).toMatchObject({ ok: false, failure: 'NOT_FOUND' });
  });
});
