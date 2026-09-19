import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/db/index.js';
import { resetAndSeed } from '../src/db/seed.js';
import {
  MockFeatureFlagSystem,
  type FeatureFlagApplyInput,
  type FeatureFlagSystem,
} from '../src/gateway/featureFlagSystem.js';
import * as flagsRepo from '../src/repo/flags.js';
import { getUser } from '../src/repo/refunds.js';
import { changeFlag } from '../src/service/changeFlag.js';

vi.mock('../src/repo/flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof flagsRepo>();
  return { ...actual, getFlagState: vi.fn(actual.getFlagState) };
});

const { applyFlagStateTransition, getFlagState, listFlagAuditEvents } = flagsRepo;

let dir: string;
let file: string;
let a: Db;
let b: Db;

function countingFlagSystem(): { system: FeatureFlagSystem; calls: FeatureFlagApplyInput[] } {
  const mock = new MockFeatureFlagSystem();
  const calls: FeatureFlagApplyInput[] = [];
  return {
    calls,
    system: {
      applyFlag(input: FeatureFlagApplyInput) {
        calls.push(input);
        return mock.applyFlag(input);
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(getFlagState).mockClear();
  dir = mkdtempSync(join(tmpdir(), 'flag-admin-'));
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

describe('concurrent changes to the same flag and environment', () => {
  it('lets only one connection win the guarded compare-and-swap', () => {
    const updatedAt = '2026-02-01T00:00:00.000Z';
    const transition = {
      flagId: 'ff-bulk-refunds',
      environment: 'development',
      expectedCurrent: false,
      desired: true,
      updatedAt,
    } as const;

    expect(applyFlagStateTransition(a, transition)).toBe(true);
    expect(applyFlagStateTransition(b, transition)).toBe(false);
    expect(getFlagState(b, 'ff-bulk-refunds', 'development')!.enabled).toBe(true);
  });

  it('resolves the loser as CONFLICT with no second audit event and no external call', () => {
    const { system, calls } = countingFlagSystem();

    // Connection B reads the flag as disabled before A changes it; the service
    // call below then races on that now-stale value.
    const staleState = getFlagState(b, 'ff-bulk-refunds', 'development')!;
    expect(staleState.enabled).toBe(false);

    expect(
      changeFlag(a, system, {
        actor: getUser(a, 'user-developer')!,
        flagId: 'ff-bulk-refunds',
        environment: 'development',
        enabled: true,
        reasonNote: 'first developer wins',
      }).ok,
    ).toBe(true);

    vi.mocked(getFlagState).mockReturnValueOnce(staleState);
    const second = changeFlag(b, system, {
      actor: getUser(b, 'user-developer-2')!,
      flagId: 'ff-bulk-refunds',
      environment: 'development',
      enabled: true,
      reasonNote: 'second developer loses the race',
    });

    expect(second).toMatchObject({ ok: false, failure: 'CONFLICT' });
    expect(getFlagState(b, 'ff-bulk-refunds', 'development')!.enabled).toBe(true);
    expect(listFlagAuditEvents(b, 'ff-bulk-refunds')).toHaveLength(1);
    expect(calls).toEqual([
      { flagKey: 'bulk-refunds', environment: 'development', enabled: true },
    ]);
  });

  it('does not report a stale apparent no-op as nothing to do', () => {
    const { system, calls } = countingFlagSystem();

    // Connection B reads the flag as disabled and asks for it to stay
    // disabled: an apparent no-op against a value that A is about to change.
    const staleState = getFlagState(b, 'ff-bulk-refunds', 'development')!;
    expect(staleState.enabled).toBe(false);

    expect(
      changeFlag(a, system, {
        actor: getUser(a, 'user-developer')!,
        flagId: 'ff-bulk-refunds',
        environment: 'development',
        enabled: true,
        reasonNote: 'enabling before the other writer acts',
      }).ok,
    ).toBe(true);

    const second = changeFlag(b, system, {
      actor: getUser(b, 'user-developer-2')!,
      flagId: 'ff-bulk-refunds',
      environment: 'development',
      enabled: staleState.enabled,
      reasonNote: 'keeping it disabled',
    });

    expect(second.ok).toBe(true);
    expect(second).not.toMatchObject({ failure: 'NO_OP' });
    expect(getFlagState(b, 'ff-bulk-refunds', 'development')!.enabled).toBe(false);
    expect(listFlagAuditEvents(b, 'ff-bulk-refunds')).toMatchObject([
      { fromEnabled: false, toEnabled: true },
      { fromEnabled: true, toEnabled: false },
    ]);
    expect(calls).toEqual([
      { flagKey: 'bulk-refunds', environment: 'development', enabled: true },
      { flagKey: 'bulk-refunds', environment: 'development', enabled: false },
    ]);
  });

  it('never calls the external system for a no-op toggle', () => {
    const { system, calls } = countingFlagSystem();

    const outcome = changeFlag(a, system, {
      actor: getUser(a, 'user-developer')!,
      flagId: 'ff-dark-mode',
      environment: 'development',
      enabled: true,
      reasonNote: 'already enabled',
    });

    expect(outcome).toMatchObject({ ok: false, failure: 'NO_OP' });
    expect(calls).toHaveLength(0);
    expect(listFlagAuditEvents(b, 'ff-dark-mode')).toHaveLength(0);
  });
});
