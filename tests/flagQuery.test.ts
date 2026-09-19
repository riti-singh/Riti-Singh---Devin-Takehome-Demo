import { describe, expect, it } from 'vitest';
import { filterFlags, parseEnvironment, parseFlagState } from '../src/domain/flagQuery.js';
import { SEED_FEATURE_FLAGS, SEED_FLAG_STATES } from '../src/db/seed.js';
import type { FeatureFlag } from '../src/domain/types.js';

const keys = (flags: FeatureFlag[]): string[] => flags.map((f) => f.key);

describe('filterFlags', () => {
  it('returns every flag with no filters', () => {
    expect(filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES)).toHaveLength(
      SEED_FEATURE_FLAGS.length,
    );
  });

  it('searches key and description case-insensitively', () => {
    expect(keys(filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, { q: 'CHECKOUT' }))).toEqual([
      'checkout-v2',
    ]);
    expect(keys(filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, { q: 'dark colour' }))).toEqual([
      'dark-mode',
    ]);
    expect(filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, { q: 'nope' })).toHaveLength(0);
  });

  it('filters by state within the selected environment', () => {
    expect(
      keys(
        filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, {
          environment: 'production',
          state: 'enabled',
        }),
      ),
    ).toEqual(['dark-mode']);
    expect(
      keys(
        filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, {
          environment: 'development',
          state: 'enabled',
        }),
      ),
    ).toEqual(['checkout-v2', 'dark-mode']);
    expect(
      keys(
        filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, {
          environment: 'production',
          state: 'disabled',
        }),
      ),
    ).toEqual(['checkout-v2', 'bulk-refunds', 'flag-apply-fail']);
  });

  it('matches any environment when none is selected', () => {
    expect(
      keys(filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, { state: 'enabled' })),
    ).toEqual(['checkout-v2', 'dark-mode']);
  });

  it('ignores the environment selection on its own', () => {
    expect(
      filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, { environment: 'production' }),
    ).toHaveLength(SEED_FEATURE_FLAGS.length);
  });

  it('combines search with a state filter', () => {
    expect(
      keys(
        filterFlags(SEED_FEATURE_FLAGS, SEED_FLAG_STATES, {
          q: 'dark',
          environment: 'production',
          state: 'disabled',
        }),
      ),
    ).toEqual([]);
  });
});

describe('flag query parsing', () => {
  it('accepts known values and rejects everything else', () => {
    expect(parseEnvironment('production')).toBe('production');
    expect(parseEnvironment('all')).toBe('all');
    expect(parseEnvironment('staging')).toBeUndefined();
    expect(parseFlagState('enabled')).toBe('enabled');
    expect(parseFlagState('disabled')).toBe('disabled');
    expect(parseFlagState('on')).toBeUndefined();
  });
});
