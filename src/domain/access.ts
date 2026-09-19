import { canChangeFlag, ENVIRONMENTS } from './flagRules.js';
import { canDecide } from './rules.js';
import type { Environment, Role } from './types.js';

export interface AccessSummary {
  /** Environments the role may change flags in, in `ENVIRONMENTS` order. */
  flagEnvironments: Environment[];
  refunds: string;
  flags: string;
  /** Both tools in one line, e.g. "approve/reject refunds; read-only for flags". */
  summary: string;
}

/**
 * Describes what a role can do across both tools. Derived entirely from the
 * pure rules the middleware enforces, so the copy cannot drift from the
 * enforcement.
 */
export function describeAccess(role: Role): AccessSummary {
  const flagEnvironments = ENVIRONMENTS.filter((env) => canChangeFlag(role, env));
  const refunds = canDecide(role) ? 'approve/reject refunds' : 'read-only for refunds';
  const flags =
    flagEnvironments.length === 0
      ? 'read-only for flags'
      : flagEnvironments.length === ENVIRONMENTS.length
        ? 'change flags in any environment'
        : `change flags in ${flagEnvironments.join(' and ')}`;
  const readOnlyEverywhere = !canDecide(role) && flagEnvironments.length === 0;
  return {
    flagEnvironments,
    refunds,
    flags,
    summary: readOnlyEverywhere ? 'read-only across both tools' : `${refunds}; ${flags}`,
  };
}
