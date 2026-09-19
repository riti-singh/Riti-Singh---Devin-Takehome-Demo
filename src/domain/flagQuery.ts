import { ENVIRONMENTS } from './flagRules.js';
import type { Environment, FeatureFlag, FeatureFlagState } from './types.js';

export type FlagStateFilter = 'enabled' | 'disabled';

export interface FlagQuery {
  q?: string;
  environment?: Environment | 'all';
  state?: FlagStateFilter | 'all';
}

export function parseEnvironment(value: unknown): Environment | 'all' | undefined {
  if (value === 'all') return 'all';
  return ENVIRONMENTS.find((env) => env === value);
}

export function parseFlagState(value: unknown): FlagStateFilter | 'all' | undefined {
  if (value === 'all' || value === 'enabled' || value === 'disabled') return value;
  return undefined;
}

function matchesText(flag: FeatureFlag, needle: string): boolean {
  return [flag.key, flag.description].some((field) => field.toLowerCase().includes(needle));
}

/**
 * Filters the flag list by text and by enabled/disabled state. The environment
 * selection narrows which environments the state filter looks at; on its own it
 * changes nothing, since every flag has a state in every environment.
 */
export function filterFlags(
  flags: FeatureFlag[],
  states: FeatureFlagState[],
  { q, environment = 'all', state = 'all' }: FlagQuery = {},
): FeatureFlag[] {
  const needle = q?.trim().toLowerCase();
  const environments = environment === 'all' ? ENVIRONMENTS : [environment];
  return flags.filter((flag) => {
    if (needle && !matchesText(flag, needle)) return false;
    if (state === 'all') return true;
    return environments.some((env) =>
      states.some(
        (s) => s.flagId === flag.id && s.environment === env && s.enabled === (state === 'enabled'),
      ),
    );
  });
}
