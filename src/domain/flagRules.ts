import { isReasonValid } from './rules.js';
import type { Environment, Role } from './types.js';

export type FlagRuleFailure = 'FORBIDDEN_ROLE' | 'REASON_REQUIRED';

export type FlagRuleResult = { ok: true } | { ok: false; failure: FlagRuleFailure };

export const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

/** Developers may only change `development`; admins may change every environment. */
export function canChangeFlag(role: Role, environment: Environment): boolean {
  if (role === 'admin') return true;
  if (role === 'developer') return environment === 'development';
  return false;
}

export function evaluateFlagChange(input: {
  role: Role;
  environment: Environment;
  reasonNote: string | undefined | null;
}): FlagRuleResult {
  if (!canChangeFlag(input.role, input.environment)) return { ok: false, failure: 'FORBIDDEN_ROLE' };
  if (!isReasonValid(input.reasonNote)) return { ok: false, failure: 'REASON_REQUIRED' };
  return { ok: true };
}

export { isReasonValid };
